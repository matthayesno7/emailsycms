import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { fetchLimited, IMAGE_EXT } from '@/lib/net';
import { imageSize } from '@/lib/imageSize';
import { askClaude, hasClaude, jsonFrom } from '@/lib/anthropic';
import { KIT_PROMPT, combine, heuristicKit, parseCss, parseHtml, type Signals } from '@/lib/brandExtract';
import { mergeKit, missing, normaliseKit, warnings, type BrandKit } from '@/lib/brandKit';

// Builds a draft brand kit from a website: reads the page and its stylesheets, finds the logo,
// then Claude assigns colours and fonts to roles (a heuristic does it when no API key is set).
// Static fetch only: sites that render everything with JavaScript give thinner results.

export const runtime = 'nodejs';
export const maxDuration = 60;

function normaliseUrl(raw: string) {
  const s = raw.trim();
  if (!s) return null;
  try { return new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).toString(); } catch { return null; }
}

async function importImage(
  supabase: SupabaseClient, ws: string, userId: string,
  file: { buf: Buffer; type: string }, meta: { kind: 'logo' | 'image'; name: string; from: string; site: string },
) {
  // Same source imported before: reuse it rather than adding a duplicate.
  const { data: prior } = await supabase.from('assets').select('id').eq('workspace_id', ws).eq('kind', meta.kind).contains('provenance', { imported_from: meta.from }).limit(1);
  if (prior?.[0]) return prior[0].id as string;
  const ext = IMAGE_EXT[file.type] || 'png';
  const path = `${ws}/brand/${crypto.randomUUID()}.${ext}`;
  const up = await supabase.storage.from('assets').upload(path, file.buf, { contentType: file.type });
  if (up.error) return null;
  const size = imageSize(file.buf);
  const { data, error } = await supabase.from('assets').insert({
    workspace_id: ws, kind: meta.kind, name: meta.name.slice(0, 120), storage_path: path, mime: file.type, bytes: file.buf.length,
    width: size?.w ?? null, height: size?.h ?? null, origin: 'uploaded', status: 'approved', created_by: userId,
    provenance: { via: 'brand_kit', imported_from: meta.from, site: meta.site, at: new Date().toISOString() },
  }).select('id').single();
  return error ? null : (data.id as string);
}

async function findLogo(s: Signals): Promise<{ buf: Buffer; type: string; from: string } | null> {
  for (const c of s.logos) {
    if (c.svg) return { buf: Buffer.from(c.svg), type: 'image/svg+xml', from: `${s.url}#inline-logo` };
    if (c.url) {
      const r = await fetchLimited(c.url, { accept: 'image/*', maxBytes: 5_000_000, timeoutMs: 10000 });
      if (!('error' in r) && (r.type.startsWith('image/') || /\.svg(\?|$)/i.test(c.url))) return { buf: r.buf, type: r.type.startsWith('image/') ? r.type : 'image/svg+xml', from: c.url };
    }
  }
  // Fall back to the biggest touch icon: square, but at least it's theirs.
  const icon = s.icons.find((i) => i.size >= 120);
  if (icon) {
    const r = await fetchLimited(icon.url, { accept: 'image/*', maxBytes: 2_000_000, timeoutMs: 8000 });
    if (!('error' in r) && r.type.startsWith('image/') && !/icon/.test(r.type)) return { buf: r.buf, type: r.type, from: icon.url };
  }
  return null;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const ws = String(body?.workspace_id || '');
  const url = normaliseUrl(String(body?.url || ''));
  if (!ws || !url) return Response.json({ error: 'Add a website address, like yourbrand.com.' }, { status: 400 });

  // Row level security: only returns the workspace if the user is a member.
  const { data: workspace } = await supabase.from('workspaces').select('id, name').eq('id', ws).maybeSingle();
  if (!workspace) return Response.json({ error: 'Workspace not found.' }, { status: 404 });

  // 1. The page.
  const page = await fetchLimited(url, { accept: 'text/html,application/xhtml+xml', maxBytes: 4_000_000 });
  if ('error' in page) return Response.json({ error: `Couldn’t open ${url} (${page.error}). Check the address, or try the brand’s main shop page.` }, { status: 422 });
  if (!/html|xml|text\/plain/.test(page.type)) return Response.json({ error: 'That address isn’t a web page.' }, { status: 422 });
  const html = page.buf.toString('utf8');
  const h = parseHtml(html, page.url);

  // 2. Its stylesheets (the first few; that's where brand colours and fonts live).
  const sheets = await Promise.all(h.stylesheets.slice(0, 6).map(async (href) => {
    const r = await fetchLimited(href, { accept: 'text/css,*/*', maxBytes: 2_500_000, timeoutMs: 10000 });
    return 'error' in r ? '' : r.buf.toString('utf8');
  }));
  const css = parseCss([h.inlineCss, ...sheets].join('\n'), page.url);
  const signals = combine(page.url, h, css);
  const name = (signals.site_name || signals.title.split(/[|–—:·-]/)[0] || workspace.name).trim().slice(0, 80);

  // 3. A photo from the site (its share image) to read the imagery style from.
  let photo: { buf: Buffer; type: string } | null = null;
  if (signals.og_image) {
    const r = await fetchLimited(signals.og_image, { accept: 'image/*', maxBytes: 4_000_000, timeoutMs: 10000 });
    if (!('error' in r) && /image\/(jpeg|png|webp|gif)/.test(r.type)) photo = r;
  }

  // 4. Roles: Claude when available, the heuristic otherwise (and to fill gaps either way).
  const base = heuristicKit(signals, name);
  let kit: BrandKit = base;
  let usedClaude = false;
  if (hasClaude()) {
    const forClaude = { ...signals, logos: signals.logos.map((l) => ({ url: l.url, alt: l.alt, where: l.where, inline_svg: !!l.svg })) };
    const content: any[] = [{ type: 'text', text: `${KIT_PROMPT}\n\nSignals from ${page.url}:\n${JSON.stringify(forClaude).slice(0, 60000)}` }];
    if (photo) content.push({ type: 'image', source: { type: 'base64', media_type: photo.type, data: photo.buf.toString('base64') } });
    const parsed = jsonFrom(await askClaude(content, { maxTokens: 1500 }));
    if (parsed) { kit = mergeKit(base, normaliseKit(parsed, name)); usedClaude = true; }
  }
  kit.website = page.url;

  // 5. Existing kit: a rebuild refreshes what the site shows and keeps everything else.
  const { data: existing } = await supabase.from('brand_kits').select('*').eq('workspace_id', ws).maybeSingle();
  const prior = existing ? normaliseKit(existing.kit, name) : null;

  // 6. Logo and a reference photo go into the library (once), and the kit points at them.
  if (!prior?.logos.primary) {
    const logo = await findLogo(signals);
    if (logo) kit.logos.primary = await importImage(supabase, ws, user.id, logo, { kind: 'logo', name: `${name} logo`, from: logo.from, site: page.url });
  }
  if (photo && !prior?.imagery.references.length) {
    const ref = await importImage(supabase, ws, user.id, photo, { kind: 'image', name: `${name} brand photo`, from: signals.og_image!, site: page.url });
    if (ref) kit.imagery.references = [ref];
  }

  const merged = prior ? mergeKit(prior, kit) : normaliseKit(kit, name);
  const row = {
    workspace_id: ws,
    kit: merged,
    status: 'draft',
    version: (existing?.version || 0) + 1,
    source: { type: 'website', url: page.url, at: new Date().toISOString() },
    updated_by: user.id,
  };
  const { data: saved, error } = await supabase.from('brand_kits').upsert(row, { onConflict: 'workspace_id' }).select('*').single();
  if (error) return Response.json({ error: `Couldn’t save the brand kit: ${error.message}` }, { status: 400 });

  return Response.json({
    kit: saved,
    found: { stylesheets: sheets.filter(Boolean).length, logo: !!merged.logos.primary, photo: !!merged.imagery.references.length, used_claude: usedClaude },
    missing: missing(merged),
    warnings: warnings(merged),
  });
}
