// Runs a "Make…" action (lib/actions.ts) on library images. Server only.
// Resize is a plain crop (no AI, saved as copies like the photo editor's "Save as copy").
// The rest use Create's makers, so the same models, plan rules, design counting, drafts and provenance apply.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Repo } from './mcp/server';
import { actionById, actionPrompt, SOCIAL_SIZES, type ActionId } from './actions';
import { makeImages, startClip, type Fail } from './makeMedia';
import { editImage, describeEdit } from './serverImage';
import { uploadEmailCopy } from './uploadEmailCopy';
import { nearestAspect } from './models';
import { ASPECTS } from './imageGen';
import { isAvailable } from './lifecycle';
import { planOf } from './billing';
import { can } from './roles';
import { IMAGE_EXT } from './net';

export type ActionResult = {
  source: { id: string; name: string };
  assets: { id: string; name: string; url: string | null; width: number | null; height: number | null; status: string }[];
  error?: string;
};
export type ActionOut = { action: ActionId; results: ActionResult[]; model?: string; designs: number; job?: string } | Fail;

const fail = (error: string, code: Fail['code'], status: number): Fail => ({ error, code, status });

export async function runAction(repo: Repo, db: SupabaseClient, o: {
  wsId: string; userId: string; role: string; action: unknown; assetIds: unknown; choice?: unknown; detail?: unknown; sizes?: unknown;
}): Promise<ActionOut> {
  const def = actionById(o.action);
  if (!def) return fail('Pick something to make.', 'bad', 400);
  const ids = (Array.isArray(o.assetIds) ? o.assetIds : []).map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, def.batch ? 10 : 1);
  if (!ids.length) return fail('Pick an image first.', 'bad', 400);
  const choice = String(o.choice || '').trim().slice(0, 120);
  const detail = String(o.detail || '').trim().slice(0, 500);
  if (def.kind !== 'resize' && def.choices && !choice && !(def.ask && detail)) return fail('Pick one of the options.', 'bad', 400);
  if (def.choices && choice && !def.choices.includes(choice)) return fail('Pick one of the options.', 'bad', 400);

  const { data } = await db.from('assets').select('*').eq('workspace_id', o.wsId).in('id', ids);
  const rows = (data || []).filter((a: any) => ['image', 'logo', 'product'].includes(a.kind) && a.storage_path && !/svg|gif|video/.test(a.mime || '') && isAvailable(a));
  if (!rows.length) return fail('Those files can’t be used: pick photos or images (not SVGs, GIFs or videos) that are still available.', 'bad', 400);

  // ---------- Resize for social: copies, cropped around the focal point ----------
  if (def.kind === 'resize') {
    if (!can.manage(o.role)) return fail('That needs an editor, admin or owner of this brand.', 'bad', 403);
    if ((await planOf(db, o.wsId)).plan === 'free') return fail('Resizing is part of editing, on Pro. Upgrade in Settings › Plan & usage.', 'upgrade', 402);
    const want = Array.isArray(o.sizes) && o.sizes.length ? SOCIAL_SIZES.filter((s) => (o.sizes as unknown[]).includes(s.id)) : [...SOCIAL_SIZES];
    if (!want.length) return fail('Pick at least one size.', 'bad', 400);
    const results: ActionResult[] = [];
    for (const a of rows) {
      const r: ActionResult = { source: { id: a.id, name: a.name }, assets: [] };
      try {
        const file = await repo.download(a.storage_path);
        if (!file) throw new Error('Couldn’t read the file.');
        const buf = Buffer.from(await file.blob.arrayBuffer());
        for (const s of want) {
          const out = await editImage(buf, a.mime || file.mime, { width: s.w, height: s.h, focus: a.focus || null });
          if ('error' in out) throw new Error(out.error);
          const path = `${o.wsId}/edits/${crypto.randomUUID()}.${IMAGE_EXT[out.mime] || 'jpg'}`;
          await repo.upload(path, out.buf, out.mime);
          const images = await uploadEmailCopy(db, o.wsId, out.buf, out.mime);
          const fileRow = { storage_path: path, mime: out.mime, width: out.width, height: out.height, bytes: out.buf.length, images, phash: null, by: o.userId };
          const { data: copy, error } = await db.rpc('asset_save_copy', { p_asset: a.id, p_file: fileRow, p_name: `${a.name} (${s.label})`, p_note: describeEdit({ width: s.w, height: s.h }, { w: out.width, h: out.height }).replace(' (with Claude)', '') });
          if (error || !copy) throw new Error(error?.message || 'Couldn’t save the copy.');
          r.assets.push({ id: (copy as any).id, name: (copy as any).name, url: await repo.signedUrl(path), width: out.width, height: out.height, status: (copy as any).status });
        }
      } catch (e: any) { r.error = e?.message || 'Couldn’t resize this one.'; }
      results.push(r);
    }
    return { action: def.id, results, designs: 0 };
  }

  const kit = await repo.getBrandKit(o.wsId);
  const prompt = actionPrompt(def.id, choice, detail, (kit?.kit as any)?.colors?.primary || null);
  const label = choice || detail.slice(0, 40);

  // ---------- Animate: one clip, ready in a minute or two ----------
  if (def.kind === 'video') {
    const a = rows[0];
    const r = await startClip(repo, db, { wsId: o.wsId, userId: o.userId, prompt, referenceId: a.id, aspect: (a.width || 16) < (a.height || 9) ? '9:16' : '16:9', seconds: 6, name: `${a.name}, ${label.toLowerCase()}` });
    if ('error' in r) return r;
    return { action: def.id, results: [{ source: { id: a.id, name: a.name }, assets: [] }], model: r.model, designs: r.designs, job: r.job };
  }

  // ---------- AI images: each photo in turn, as drafts ----------
  const results: ActionResult[] = [];
  let designs = 0, model: string | undefined;
  for (const a of rows) {
    const aspect = a.width && a.height ? nearestAspect(a.width, a.height, ASPECTS as unknown as string[]) : '1:1';
    const r = await makeImages(repo, db, {
      wsId: o.wsId, userId: o.userId, prompt, referenceIds: [a.id], aspect, count: def.takes || 1,
      purpose: def.id === 'translate' ? 'text' : 'product', name: `${a.name}, ${label}`,
    });
    if ('error' in r) {
      // Plan, allowance or switched off: stop and say so. A model hiccup on one photo: carry on with the rest.
      if (r.code === 'upgrade' || r.code === 'limit' || r.code === 'off' || !results.length && rows.length === 1) return r;
      results.push({ source: { id: a.id, name: a.name }, assets: [], error: r.error });
      continue;
    }
    designs += r.designs; model = r.model;
    results.push({ source: { id: a.id, name: a.name }, assets: r.assets.map((m) => ({ id: m.row.id, name: m.row.name, url: m.url, width: m.row.width ?? null, height: m.row.height ?? null, status: m.row.status })) });
  }
  return { action: def.id, results, model, designs };
}
