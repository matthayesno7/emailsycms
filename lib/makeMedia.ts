// Making new images and video, server only. Shared by Create (app/api/make) and the Claude connector,
// so both use the same models, plan rules, usage counting and provenance.
import type { AssetRow, Repo } from './mcp/server';
import { ASPECTS, brandPrompt, designsFor, generateImages, hasImageGen, routeFor, type Aspect, type Ref } from './imageGen';
import { PURPOSES, type Purpose } from './models';
import { VIDEO_ASPECTS, VIDEO_DESIGNS, VIDEO_SECONDS, downloadVideo, hasVideoGen, pollVideo, startVideo } from './videoGen';
import { isAvailable } from './lifecycle';
import { imageSize } from './imageSize';
import { planOf } from './billing';
import { limitMessage, takeUsage } from './usage';

export type Fail = { error: string; code?: 'off' | 'upgrade' | 'limit' | 'bad'; status: number };
const fail = (error: string, code: Fail['code'], status: number): Fail => ({ error, code, status });

async function gate(db: any, wsId: string, what: string): Promise<Fail | null> {
  if (db && (await planOf(db, wsId)).plan === 'free') return fail(`${what} is on Pro. Upgrade in Settings › Plan & usage.`, 'upgrade', 402);
  return null;
}

// The email-ready copy of a library image is plenty for a model and keeps requests small.
async function refFor(repo: Repo, wsId: string, id: string): Promise<{ ref: Ref; id: string } | null> {
  const a = await repo.getAsset(String(id));
  if (!a || a.workspace_id !== wsId || !isAvailable(a)) return null;
  const path = a.images?.email?.path || a.storage_path;
  if (!path || /svg|video/.test(a.mime || '')) return null;
  const got = await repo.download(path);
  if (!got || got.blob.size > 8_000_000) return null;
  return { ref: { mime: got.mime || 'image/jpeg', data: Buffer.from(await got.blob.arrayBuffer()), label: a.name }, id: a.id };
}

export type Made = { row: AssetRow; url: string | null };

export async function makeImages(repo: Repo, db: any, o: {
  wsId: string; userId: string; prompt: string; referenceIds?: string[]; pid?: string | null;
  aspect?: string; purpose?: string; count?: number; name?: string;
  onBoard?: boolean; // made on a Create board: stays there until someone saves it
  refBufs?: Ref[];    // pictures made on the fly (a photo with a marked area, a padded canvas), sent before any library ones
  via?: string; extra?: Record<string, unknown>; // what made it, for provenance
}): Promise<{ assets: Made[]; model: string; purpose: string; designs: number } | Fail> {
  if (!hasImageGen()) return fail('Image generation isn’t switched on for this Mise yet.', 'off', 501);
  const locked = await gate(db, o.wsId, 'Making new images');
  if (locked) return locked;
  const prompt = String(o.prompt || '').trim().slice(0, 3000);
  if (!prompt) return fail('Say what image to make.', 'bad', 400);
  const refs: Ref[] = [...(o.refBufs || [])].slice(0, 4);
  const refIds: string[] = [];
  for (const id of (o.referenceIds || []).slice(0, 4)) {
    const r = await refFor(repo, o.wsId, id);
    if (r) { refs.push(r.ref); refIds.push(r.id); }
  }
  const kitRow = await repo.getBrandKit(o.wsId);
  const product = o.pid ? (await repo.listAssets([o.wsId], { kind: 'product', query: String(o.pid), limit: 20 })).find((h) => h.pid === String(o.pid)) || null : null;
  const full = brandPrompt(prompt, (kitRow?.kit as any) || null, { hasProduct: !!product || refs.length > 0 });
  const aspect = (ASPECTS as readonly string[]).includes(String(o.aspect)) ? (o.aspect as Aspect) : '1:1';
  const count = Math.max(1, Math.min(4, Math.floor(Number(o.count) || 1)));
  const purpose = (PURPOSES as readonly string[]).includes(String(o.purpose)) ? (o.purpose as Purpose) : 'auto';
  const route = routeFor(purpose, { prompt, refs: refs.length, aspect });
  const designs = designsFor(route, count);
  const take = await takeUsage(o.wsId, 'design', designs);
  if (!take.ok) return fail(limitMessage('design', take), 'limit', 429);
  const out = await generateImages({ prompt: full, refs: route.api === 'imagen' ? [] : refs, aspect, route, count });
  if ('error' in out) return fail(out.error, undefined, 502);
  const ext = out.mime.includes('png') ? 'png' : out.mime.includes('webp') ? 'webp' : 'jpg';
  const base = String(o.name || prompt).trim().slice(0, 110) || 'New image';
  const assets: Made[] = [];
  for (const [i, buf] of out.bufs.entries()) {
    const path = `${o.wsId}/generated/${crypto.randomUUID()}.${ext}`;
    await repo.upload(path, buf, out.mime);
    const size = imageSize(buf);
    const row = await repo.insertAsset({
      workspace_id: o.wsId, kind: 'image', name: out.bufs.length > 1 ? `${base} (${i + 1})` : base,
      storage_path: path, mime: out.mime, bytes: buf.length, width: size?.w ?? null, height: size?.h ?? null,
      origin: 'generated', status: 'draft', created_by: o.userId, fields: {}, ...(o.onBoard ? { on_board: true } : {}),
      provenance: { via: o.via || 'mise-image', ...(o.extra || {}), prompt, model: out.model, purpose: out.route.purpose, aspect_ratio: aspect, source_product_pid: product?.pid || null, source_asset_ids: [...new Set([...(product ? [product.id] : []), ...refIds])], brand_kit_version: kitRow?.version ?? null, generated_at: new Date().toISOString() },
      figma: null,
    });
    assets.push({ row, url: await repo.signedUrl(path) });
  }
  return { assets, model: out.model, purpose: out.route.purpose, designs };
}

// ---------- video: a job that saves itself when ready ----------
type ClipMeta = { name: string; prompt: string | null; model: string | null; aspect: string | null; seconds: number | null; source: string | null; kitVersion: number | null; onBoard?: boolean };
const saving = new Set<string>();

export async function startClip(repo: Repo, db: any, o: {
  wsId: string; userId: string; prompt: string; referenceId?: string | null; aspect?: string; seconds?: number; name?: string;
  onBoard?: boolean;
}): Promise<{ job: string; model: string; designs: number } | Fail> {
  if (!hasVideoGen()) return fail('Video isn’t switched on for this Mise yet.', 'off', 501);
  const locked = await gate(db, o.wsId, 'Making video');
  if (locked) return locked;
  const prompt = String(o.prompt || '').trim().slice(0, 3000);
  if (!prompt) return fail('Describe the clip to make.', 'bad', 400);
  let image: Ref | null = null;
  let source: string | null = null;
  if (o.referenceId) {
    const r = await refFor(repo, o.wsId, o.referenceId);
    if (!r) return fail('That image can’t be animated: pick an available photo or image.', 'bad', 400);
    image = r.ref; source = r.id;
  }
  const kitRow = await repo.getBrandKit(o.wsId);
  const full = brandPrompt(prompt, (kitRow?.kit as any) || null, { hasProduct: !!image });
  const aspect = (VIDEO_ASPECTS as readonly string[]).includes(String(o.aspect)) ? (o.aspect as '16:9' | '9:16') : '16:9';
  const seconds = (VIDEO_SECONDS as readonly number[]).includes(Number(o.seconds)) ? Number(o.seconds) : 8;
  const take = await takeUsage(o.wsId, 'design', VIDEO_DESIGNS);
  if (!take.ok) return fail(limitMessage('design', take), 'limit', 429);
  const started = await startVideo({ prompt: full, image, aspect, seconds });
  if ('error' in started) return fail(started.error, undefined, 502);
  watch(repo, db, o.wsId, o.userId, started.job, { name: String(o.name || prompt).trim().slice(0, 120) || 'New video', prompt, model: started.model, aspect, seconds, source, kitVersion: kitRow?.version ?? null, onBoard: !!o.onBoard });
  return { job: started.job, model: started.model, designs: VIDEO_DESIGNS };
}

async function savedClip(db: any, wsId: string, job: string): Promise<AssetRow | null> {
  if (!db || !job) return null;
  const { data } = await db.from('assets').select('*').eq('workspace_id', wsId).eq('provenance->>job', job).limit(1).maybeSingle();
  return (data as AssetRow) || null;
}

async function saveClip(repo: Repo, db: any, wsId: string, userId: string, job: string, uri: string, m: ClipMeta): Promise<AssetRow | { error: string }> {
  if (saving.has(job)) return { error: 'saving' };
  saving.add(job);
  try {
    const existing = await savedClip(db, wsId, job);
    if (existing) return existing;
    const got = await downloadVideo(uri);
    if ('error' in got) return got;
    const path = `${wsId}/generated/${crypto.randomUUID()}.mp4`;
    await repo.upload(path, got.buf, got.mime);
    return await repo.insertAsset({
      workspace_id: wsId, kind: 'video', name: m.name, storage_path: path, mime: got.mime, bytes: got.buf.length, width: null, height: null,
      origin: 'generated', status: 'draft', created_by: userId, fields: {}, ...(m.onBoard ? { on_board: true } : {}),
      provenance: { via: 'mise-video', job, prompt: m.prompt, model: m.model, aspect_ratio: m.aspect, seconds: m.seconds, source_asset_ids: m.source ? [m.source] : [], brand_kit_version: m.kitVersion, generated_at: new Date().toISOString() },
      figma: null,
    });
  } finally {
    saving.delete(job);
  }
}

function watch(repo: Repo, db: any, wsId: string, userId: string, job: string, m: ClipMeta) {
  (async () => {
    const until = Date.now() + 12 * 60_000;
    while (Date.now() < until) {
      await new Promise((r) => setTimeout(r, 10_000));
      const st = await pollVideo(job);
      if ('error' in st) { console.error('[video]', job, st.error); return; }
      if (st.done) {
        const r = await saveClip(repo, db, wsId, userId, job, st.uri, m);
        if ('error' in r && r.error !== 'saving') console.error('[video] save', job, r.error);
        return;
      }
    }
    console.warn('[video] gave up waiting', job);
  })().catch((e) => console.error('[video]', job, e?.message));
}

// Where a clip is: still making, saved (with its link), or failed.
export async function clipStatus(repo: Repo, db: any, wsId: string, userId: string, job: string): Promise<{ ready: false } | { ready: true; asset: Made } | Fail> {
  const done = await savedClip(db, wsId, job);
  if (done) return { ready: true, asset: { row: done, url: done.storage_path ? await repo.signedUrl(done.storage_path) : null } };
  const st = await pollVideo(job);
  if ('error' in st) return fail(st.error, undefined, 502);
  if (!st.done || saving.has(job)) return { ready: false };
  // Ready but not saved (the server restarted while it was being made): save it now.
  const row = await saveClip(repo, db, wsId, userId, job, st.uri, { name: 'New video', prompt: null, model: null, aspect: null, seconds: null, source: null, kitVersion: null });
  if ('error' in row) return row.error === 'saving' ? { ready: false } : fail(row.error, undefined, 502);
  return { ready: true, asset: { row, url: row.storage_path ? await repo.signedUrl(row.storage_path) : null } };
}
