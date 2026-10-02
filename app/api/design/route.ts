import { createClient } from '@/lib/supabase/server';
import { askClaude, hasClaude, jsonFrom, MODEL } from '@/lib/anthropic';
import { cleanSpec, DIRECTIONS, FORMATS, rebuildBrief, systemPrompt, userPrompt, type LibraryItem } from '@/lib/design';

// Mise Studio: one design per call (the page asks for several in parallel, so they
// arrive one by one). Also refines a design ("make the headline bigger") and resizes it.

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET() {
  return Response.json({ enabled: hasClaude(), model: MODEL });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  if (!hasClaude()) return Response.json({ error: 'not_configured' }, { status: 501 });

  const body = await request.json().catch(() => null);
  if (body?.rebuild_asset_id) return rebuild(supabase, String(body.rebuild_asset_id));
  const ws = String(body?.workspace_id || '');
  const brief = String(body?.brief || '').trim().slice(0, 1500);
  const w = Math.round(Number(body?.size?.w)), h = Math.round(Number(body?.size?.h));
  if (!ws || !brief || !(w >= 50 && w <= 4000 && h >= 50 && h <= 4000)) return Response.json({ error: 'Missing brief or size.' }, { status: 400 });

  // Row level security: these only return what the user can see.
  const [{ data: workspace }, { data: kitRow }, { data: rows }] = await Promise.all([
    supabase.from('workspaces').select('id, name').eq('id', ws).maybeSingle(),
    supabase.from('brand_kits').select('kit').eq('workspace_id', ws).maybeSingle(),
    supabase.from('assets').select('id, kind, name, width, height, pid, price, fields, storage_path, status')
      .eq('workspace_id', ws).in('kind', ['image', 'product', 'logo']).not('storage_path', 'is', null)
      .order('updated_at', { ascending: false }).limit(80),
  ]);
  if (!workspace) return Response.json({ error: 'Workspace not found.' }, { status: 404 });

  const library: LibraryItem[] = (rows || []).filter((r: any) => r.status !== 'draft').map((r: any) => ({
    id: r.id, kind: r.kind, name: r.name, alt: r.fields?.alt || r.fields?.description || undefined, w: r.width, h: r.height, pid: r.pid, price: r.price,
  }));
  const allowed = new Set(library.map((a) => a.id));
  const fmt = FORMATS.find((f) => f.w === w && f.h === h);
  const idx = Math.max(0, Math.min(DIRECTIONS.length - 1, Number(body?.variant) || 0));

  const text = await askClaude([{ type: 'text', text: userPrompt({
    brand: workspace.name, kit: kitRow?.kit || null, library, brief, size: { w, h }, formatHint: fmt?.hint,
    direction: body?.base ? undefined : DIRECTIONS[idx],
    base: body?.base || null, instruction: body?.instruction ? String(body.instruction).slice(0, 500) : null,
  }) }], { system: systemPrompt(), maxTokens: 2500 });
  const spec = cleanSpec(jsonFrom(text), allowed);
  if (!spec) return Response.json({ error: 'Claude didn’t return a design. Try again.' }, { status: 502 });
  return Response.json({ spec, size: { w, h }, model: MODEL });
}

// Make a finished picture editable: Claude looks at it and rebuilds it as a Studio layout with the
// library's real photos and logo. The picture itself is never used as a layer (its words would show twice).
async function rebuild(supabase: any, assetId: string) {
  const { data: a } = await supabase.from('assets').select('id, workspace_id, name, storage_path, images, width, height, provenance, bytes').eq('id', assetId).maybeSingle();
  if (!a?.storage_path || !a.width || !a.height) return Response.json({ error: 'Asset not found.' }, { status: 404 });
  const k = Math.min(1, 4000 / Math.max(a.width, a.height));
  const size = { w: Math.round(a.width * k), h: Math.round(a.height * k) };
  const sources: string[] = Array.isArray(a.provenance?.source_asset_ids) ? a.provenance.source_asset_ids.slice(0, 10) : [];
  const [{ data: workspace }, { data: kitRow }, { data: rows }, { data: srcRows }] = await Promise.all([
    supabase.from('workspaces').select('id, name').eq('id', a.workspace_id).maybeSingle(),
    supabase.from('brand_kits').select('kit').eq('workspace_id', a.workspace_id).maybeSingle(),
    supabase.from('assets').select('id, kind, name, width, height, pid, price, fields, status, provenance, text_in_image')
      .eq('workspace_id', a.workspace_id).in('kind', ['image', 'product', 'logo']).not('storage_path', 'is', null).neq('id', a.id)
      .order('updated_at', { ascending: false }).limit(80),
    sources.length ? supabase.from('assets').select('id, kind, name, width, height, pid, price, fields, status, provenance, text_in_image').in('id', sources).neq('id', a.id) : Promise.resolve({ data: [] }),
  ]);
  if (!workspace) return Response.json({ error: 'Workspace not found.' }, { status: 404 });
  // Photos, products and logos; not other finished designs (they have words baked in).
  const seen = new Set<string>();
  const library: LibraryItem[] = [...(srcRows || []), ...(rows || [])].filter((r: any) => r.status !== 'draft' || sources.includes(r.id))
    .filter((r: any) => !seen.has(r.id) && seen.add(r.id) && (sources.includes(r.id) || !(r.text_in_image && String(r.text_in_image).length > 20)))
    .map((r: any) => ({ id: r.id, kind: r.kind, name: r.name, alt: r.fields?.alt || undefined, w: r.width, h: r.height, pid: r.pid, price: r.price }));
  const path = a.bytes > 4_500_000 && a.images?.email?.path ? a.images.email.path : a.storage_path;
  const { data: signed } = await supabase.storage.from('assets').createSignedUrl(path, 600);
  if (!signed?.signedUrl) return Response.json({ error: 'Couldn’t read the picture.' }, { status: 500 });
  const text = await askClaude([
    { type: 'image', source: { type: 'url', url: signed.signedUrl } },
    { type: 'text', text: userPrompt({ brand: workspace.name, kit: kitRow?.kit || null, library, brief: rebuildBrief(sources.filter((id) => seen.has(id))), size }) },
  ], { system: systemPrompt(), maxTokens: 6000 });
  const spec = cleanSpec(jsonFrom(text), new Set(library.map((l) => l.id)));
  if (!spec) return Response.json({ error: 'Claude couldn’t rebuild this one. Try again.' }, { status: 502 });
  return Response.json({ spec, size, model: MODEL, rebuilt: true });
}
