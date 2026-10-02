// Works through the auto-organise queue (assets with ai_status 'pending').
// Runs inside the web server: every 20 seconds (instrumentation.ts) and straight after an
// upload or import (POST /api/jobs/tag). Uses the service-role client; every asset it touches
// came from the queue, and the brand kit and products it reads are from that asset's workspace.
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from './supabase/admin';
import { jsonFrom } from './anthropic';
import { TAG_MODEL, VISION_TYPES, MAX_VISION_BYTES, cleanResult, nameTags, patchFrom, shortlist, tagPrompt, type Candidate } from './autotag';
import type { BrandKit } from './brandKit';

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

async function tagOne(ctx: Ctx, a: any): Promise<'done' | 'failed' | 'limited'> {
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
async function fail(ctx: Ctx, a: any, message: string, final = false): Promise<'failed'> {
  const last = final || (a.ai_attempts || 0) >= MAX_ATTEMPTS;
  await ctx.db.from('assets').update({ ai_status: last ? 'failed' : 'pending', ai_error: message.slice(0, 300) }).eq('id', a.id);
  if (last) console.warn('[autotag] failed', a.id, message);
  return 'failed';
}

// Background loop for the server process.
let timer: ReturnType<typeof setInterval> | null = null;
export function startTagWorker(everyMs = 20_000) {
  if (timer || !canTag()) return;
  timer = setInterval(() => { runQueue({ budgetMs: 45_000 }).catch((e) => console.error('[autotag]', e)); }, everyMs);
  (timer as any).unref?.();
  console.log('[autotag] worker started');
}
