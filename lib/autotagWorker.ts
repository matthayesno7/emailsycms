// Works through the auto-organise queue (assets with ai_status 'pending').
// Runs inside the web server: every 20 seconds (instrumentation.ts) and straight after an
// upload or import (POST /api/jobs/tag). Uses the service-role client; every asset it touches
// came from the queue, and the brand kit and products it reads are from that asset's workspace.
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from './supabase/admin';
import { jsonFrom } from './anthropic';
import { TAG_MODEL, VISION_TYPES, MAX_VISION_BYTES, cleanResult, nameTags, patchFrom, shortlist, tagPrompt, type Candidate } from './autotag';
import type { BrandKit } from './brandKit';
import { assetText, embed, hasVoyage, toPgVector, VOYAGE_MODEL } from './search';
import { limitMessage, takeUsage } from './usage';

const CONCURRENCY = 3;
const MAX_ATTEMPTS = 3;
const running = new Set<string>(); // per process: one run per workspace ('*' = all) at a time

type Ctx = { db: SupabaseClient; kits: Map<string, BrandKit | null>; products: Map<string, Candidate[]>; folders: Map<string, string> };

export function canTag() {
  return !!process.env.ANTHROPIC_API_KEY && !!process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.DISABLE_AUTO_TAG !== '1';
}

// Process the queue until it's empty or the time budget runs out. Returns how many were done.
export async function runQueue(opts: { ws?: string | null; budgetMs?: number } = {}) {
  if (!canTag()) return { done: 0, failed: 0, skipped: true };
  const key = opts.ws || '*';
  if (running.has(key) || running.has('*')) return { done: 0, failed: 0, busy: true };
  running.add(key);
  const ctx: Ctx = { db: createAdminClient(), kits: new Map(), products: new Map(), folders: new Map() };
  const stop = Date.now() + (opts.budgetMs ?? 50_000);
  let done = 0, failed = 0;
  try {
    await resumePaused(ctx.db);
    while (Date.now() < stop) {
      const { data, error } = await ctx.db.rpc('claim_ai_jobs', { n: CONCURRENCY * 2, ws: opts.ws || null });
      if (error) { console.error('[autotag] claim failed', error.message); break; }
      const jobs = (data || []) as any[];
      if (!jobs.length) break;
      let limited = false;
      for (let i = 0; i < jobs.length; i += CONCURRENCY) {
        const out = await Promise.all(jobs.slice(i, i + CONCURRENCY).map((a) => (limited ? release(ctx, a) : tagOne(ctx, a))));
        for (const o of out) { if (o === 'done') done++; else if (o === 'failed') failed++; else if (o === 'limited') limited = true; }
      }
      // Rate limited: put the rest back and let the next run pick them up.
      if (limited) break;
    }
  } finally {
    running.delete(key);
  }
  return { done, failed };
}

async function release(ctx: Ctx, a: any) {
  await ctx.db.from('assets').update({ ai_status: 'pending', ai_attempts: Math.max(0, (a.ai_attempts || 1) - 1) }).eq('id', a.id);
  return 'released' as const;
}

async function kitFor(ctx: Ctx, ws: string) {
  if (!ctx.kits.has(ws)) {
    const { data } = await ctx.db.from('brand_kits').select('kit').eq('workspace_id', ws).maybeSingle();
    ctx.kits.set(ws, (data?.kit as BrandKit) || null);
  }
  return ctx.kits.get(ws) || null;
}
async function productsFor(ctx: Ctx, ws: string) {
  if (!ctx.products.has(ws)) {
    const { data } = await ctx.db.from('assets').select('id, name, pid').eq('workspace_id', ws).eq('kind', 'product').limit(5000);
    ctx.products.set(ws, (data || []) as Candidate[]);
  }
  return ctx.products.get(ws)!;
}
async function folderName(ctx: Ctx, id?: string | null) {
  if (!id) return null;
  if (!ctx.folders.has(id)) {
    const { data } = await ctx.db.from('folders').select('name').eq('id', id).maybeSingle();
    ctx.folders.set(id, data?.name || '');
  }
  return ctx.folders.get(id) || null;
}

// A URL Claude can fetch: the email-ready copy for big files, else the original.
async function imageUrl(ctx: Ctx, a: any): Promise<{ url?: string; error?: string }> {
  const email = a.images?.email;
  const big = (a.bytes || 0) > MAX_VISION_BYTES;
  const path = big && email?.path ? email.path : a.storage_path;
  if (big && !email?.path) {
    // Supabase can shrink it on the fly when image transformations are on (Pro plan).
    const { data } = await ctx.db.storage.from('assets').createSignedUrl(a.storage_path, 900, { transform: { width: 1568, height: 1568, resize: 'contain' } });
    if (data?.signedUrl) return { url: data.signedUrl };
    return { error: 'Too large to organise (over 5 MB). Upload a smaller copy.' };
  }
  const { data } = await ctx.db.storage.from('assets').createSignedUrl(path, 900);
  return data?.signedUrl ? { url: data.signedUrl } : { error: 'Couldn’t read the file.' };
}

async function tagOne(ctx: Ctx, a: any): Promise<'done' | 'failed' | 'limited' | 'paused'> {
  try {
    const kit = await kitFor(ctx, a.workspace_id);
    const folder = await folderName(ctx, a.folder_id);
    const mime = String(a.mime || '');
    // No vision for SVG and friends: tag from the name so they can still be found.
    if (!VISION_TYPES.test(mime) || !a.storage_path) {
      const edited = new Set(a.edited || []);
      const patch: Record<string, any> = { ai_status: 'skipped', ai_error: null, ai: { model: null, at: new Date().toISOString(), note: 'Organised from the file name' } };
      if (!edited.has('tags')) patch.tags = nameTags(`${a.name} ${folder || ''}`, a.kind);
      await ctx.db.from('assets').update(patch).eq('id', a.id);
      return 'done';
    }
    const src = await imageUrl(ctx, a);
    if (src.error) return fail(ctx, a, src.error, true);
    // Monthly allowance. On Free, files past the pace wait as 'paused' until the 1st or an upgrade
    // (resumePaused puts them back in the queue). Otherwise it's the fair-use ceiling: failed, with a note.
    const take = await takeUsage(a.workspace_id, 'tag');
    if (!take.ok && take.plan === 'free') { await pause(ctx, a); return 'paused'; }
    if (!take.ok) return fail(ctx, a, limitMessage('tag'), true);
    const products = a.kind === 'product' ? [] : shortlist(await productsFor(ctx, a.workspace_id), a.name, folder);
    const input = { name: a.name, kind: a.kind, folder, kit, products };
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: TAG_MODEL,
        max_tokens: 700,
        messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'url', url: src.url } }, { type: 'text', text: tagPrompt(input) }] }],
      }),
    });
    if (res.status === 429 || res.status === 529) { await release(ctx, a); return 'limited'; }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return fail(ctx, a, res.status === 400 && /image/i.test(body) ? 'Claude couldn’t read this image.' : `Claude returned ${res.status}.`, res.status === 400);
    }
    const out = await res.json().catch(() => null);
    const text = String(out?.content?.find((c: any) => c.type === 'text')?.text || '');
    const r = cleanResult(jsonFrom(text), input);
    if (!r) return fail(ctx, a, 'Claude’s answer couldn’t be read.');
    const { error } = await ctx.db.from('assets').update(patchFrom(a, r, kit, TAG_MODEL)).eq('id', a.id);
    if (error) return fail(ctx, a, error.message);
    return 'done';
  } catch (e: any) {
    return fail(ctx, a, e?.message || 'Something went wrong.');
  }
}

// Try again on the next run, up to three times; some errors aren't worth retrying.
async function pause(ctx: Ctx, a: any) {
  await ctx.db.from('assets').update({ ai_status: 'paused', ai_attempts: Math.max(0, (a.ai_attempts || 1) - 1), ai_error: null }).eq('id', a.id);
}

// Paused files go back in the queue on the 1st of the month (and straight away when a brand
// upgrades, from the billing webhook). Checked at most every 10 minutes per process.
let lastResume = 0;
async function resumePaused(db: SupabaseClient) {
  if (Date.now() - lastResume < 10 * 60e3) return;
  lastResume = Date.now();
  const { error } = await db.rpc('resume_paused_tags', { ws: null });
  if (error) console.error('[autotag] resume', error.message);
}

async function fail(ctx: Ctx, a: any, message: string, final = false): Promise<'failed'> {
  const last = final || (a.ai_attempts || 0) >= MAX_ATTEMPTS;
  await ctx.db.from('assets').update({ ai_status: last ? 'failed' : 'pending', ai_error: message.slice(0, 300) }).eq('id', a.id);
  if (last) console.warn('[autotag] failed', a.id, message);
  return 'failed';
}

// ---------- search embeddings ----------
// Assets whose searchable words changed (embed_pending) get a fresh Voyage embedding.
// Waits for auto-organise to finish with a file, so it's embedded once with its tags.
let embedding = false;
export async function runEmbeds(opts: { ws?: string | null; budgetMs?: number } = {}) {
  if (!hasVoyage() || !process.env.SUPABASE_SERVICE_ROLE_KEY || embedding) return { embedded: 0 };
  embedding = true;
  const db = createAdminClient();
  const stop = Date.now() + (opts.budgetMs ?? 40_000);
  let embedded = 0;
  try {
    while (Date.now() < stop) {
      let q = db.from('assets').select('id, workspace_id, kind, name, description, tags, colour_names, text_in_image, pid, fields, ai_status, updated_at')
        .eq('embed_pending', true).neq('kind', 'block')
        .or('ai_status.is.null,ai_status.in.(done,skipped,failed)')
        .order('updated_at', { ascending: true }).limit(64);
      if (opts.ws) q = q.eq('workspace_id', opts.ws);
      const { data, error } = await q;
      if (error) { console.error('[search] embed queue', error.message); break; }
      if (!data?.length) break;
      let vecs: number[][] | null = null;
      try { vecs = await embed(data.map((a: any) => assetText(a)), 'document'); }
      catch (e: any) { if (e?.limited) break; throw e; }
      if (!vecs) break;
      const { error: e2 } = await db.from('asset_embeddings').upsert(data.map((a: any, i: number) => ({ asset_id: a.id, workspace_id: a.workspace_id, embedding: toPgVector(vecs![i]), model: VOYAGE_MODEL, updated_at: new Date().toISOString() })), { onConflict: 'asset_id' });
      if (e2) { console.error('[search] save embeddings', e2.message); break; }
      // Only if nothing changed meanwhile (an edit while embedding stays pending and is redone).
      const done = await Promise.all(data.map((a: any) => db.from('assets').update({ embed_pending: false }).eq('id', a.id).eq('updated_at', a.updated_at).select('id')));
      embedded += data.length;
      // Safety: if none could be marked done, stop rather than embed the same files again.
      if (!done.some((r) => r.data?.length)) { console.warn('[search] embed: nothing marked done, stopping this run'); break; }
    }
  } catch (e: any) {
    console.error('[search] embed', e?.message || e);
  } finally {
    embedding = false;
  }
  return { embedded };
}

// Background loop for the server process: organise first, then make searchable.
let timer: ReturnType<typeof setInterval> | null = null;
export function startTagWorker(everyMs = 20_000) {
  if (timer || (!canTag() && !hasVoyage())) return;
  timer = setInterval(() => {
    runQueue({ budgetMs: 40_000 }).catch((e) => console.error('[autotag]', e))
      .then(() => runEmbeds({ budgetMs: 15_000 })).catch((e) => console.error('[search]', e));
  }, everyMs);
  (timer as any).unref?.();
  console.log('[autotag] worker started');
}
