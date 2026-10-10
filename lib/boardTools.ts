// The hands-on tools in a Create board's Tools menu, run on the server. Results are new files that
// stay on the board until someone saves them (assets.on_board). Server only.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AssetRow, Repo } from './mcp/server';
import { EXTEND_SHAPES, SMART_SIZES, TOOL_DESIGNS, type ToolId } from './actions';
import { makeImages, type Fail } from './makeMedia';
import { REMOVE_BG_MODEL, UPSCALE_MODEL, fetchFile, hasReplicate, runModel } from './replicate';
import { editImage } from './serverImage';
import { imageSize } from './imageSize';
import { isAvailable } from './lifecycle';
import { planOf } from './billing';
import { limitMessage, takeUsage } from './usage';
import { askClaude, hasClaude, jsonFrom } from './anthropic';
import { ASPECTS } from './imageGen';
import { nearestAspect } from './models';

export type ToolMade = { id: string; name: string; url: string | null; width: number | null; height: number | null; label?: string };
export type ToolOut = { assets: ToolMade[]; designs: number; model?: string; lines?: string[] } | Fail;
const fail = (error: string, code: Fail['code'], status: number): Fail => ({ error, code, status });
const KEEP = 'Keep everything else exactly as it is: the product, people, logo, text, colours and lighting.';

async function sharpLib() { try { return (await import('sharp')).default; } catch { return null; } }

export async function runTool(repo: Repo, db: SupabaseClient, o: {
  wsId: string; userId: string; tool: unknown; assetId: unknown;
  rect?: unknown; shape?: unknown; sizes?: unknown; edits?: unknown; scale?: unknown; colour?: unknown; purpose?: unknown;
}): Promise<ToolOut> {
  const tool = String(o.tool) as ToolId;
  if (!(tool in TOOL_DESIGNS)) return fail('Pick a tool.', 'bad', 400);
  const id = String(o.assetId || '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail('Select a picture first.', 'bad', 400);
  const { data: a } = await db.from('assets').select('*').eq('workspace_id', o.wsId).eq('id', id).maybeSingle();
  const row = a as AssetRow | null;
  if (!row || !row.storage_path || !isAvailable(row) || !['image', 'logo', 'product'].includes(row.kind) || /svg|gif|video/.test(row.mime || ''))
    return fail('That file can’t be edited here: pick a photo or image that’s still available.', 'bad', 400);
  if (tool !== 'readtext' && (await planOf(db, o.wsId)).plan === 'free') return fail('Editing is on Pro. Upgrade in Settings › Plan & usage.', 'upgrade', 402);

  const saveBuf = async (buf: Buffer, mime: string, name: string, extra: Record<string, unknown>): Promise<ToolMade> => {
    const ext = mime.includes('png') ? 'png' : mime.includes('webp') ? 'webp' : 'jpg';
    const path = `${o.wsId}/edits/${crypto.randomUUID()}.${ext}`;
    await repo.upload(path, buf, mime);
    const size = imageSize(buf);
    const r = await repo.insertAsset({
      workspace_id: o.wsId, kind: row.kind === 'logo' ? 'logo' : 'image', name: name.slice(0, 120), storage_path: path, mime, bytes: buf.length,
      width: size?.w ?? null, height: size?.h ?? null, origin: 'generated', status: 'draft', created_by: o.userId, fields: {}, on_board: true,
      provenance: { via: `board-${tool}`, source_asset_ids: [row.id], generated_at: new Date().toISOString(), ...extra }, figma: null,
    } as any);
    return { id: r.id, name: r.name, url: await repo.signedUrl(path), width: r.width ?? null, height: r.height ?? null };
  };
  const original = async () => {
    const f = await repo.download(row.storage_path!);
    return f ? { buf: Buffer.from(await f.blob.arrayBuffer()), mime: f.mime || row.mime || 'image/jpeg' } : null;
  };
  const aspectOf = (w?: number | null, h?: number | null) => (w && h ? nearestAspect(w, h, ASPECTS as unknown as string[]) : '1:1');

  // ---------- Replicate: a real cut-out, and more pixels ----------
  if (tool === 'removebg' || tool === 'upscale') {
    if (!hasReplicate()) return fail('This tool isn’t switched on yet. Add REPLICATE_API_TOKEN on the server.', 'off', 501);
    const take = await takeUsage(o.wsId, 'design', TOOL_DESIGNS[tool]);
    if (!take.ok) return fail(limitMessage('design', take), 'limit', 429);
    const url = await repo.signedUrl(row.storage_path);
    if (!url) return fail('Couldn’t read the file.', undefined, 500);
    const scale = Number(o.scale) === 4 ? 4 : 2;
    const model = tool === 'removebg' ? REMOVE_BG_MODEL() : UPSCALE_MODEL();
    const run = await runModel(model, tool === 'removebg' ? { image: url } : { image: url, upscale_factor: `${scale}x`, output_format: 'png' });
    if ('error' in run) return fail(run.error, undefined, 502);
    const got = await fetchFile(run.url);
    if (!got) return fail('Couldn’t fetch the result.', undefined, 502);
    let buf = got.buf, mime = got.mime.includes('image') ? got.mime : 'image/png';
    const colour = typeof o.colour === 'string' && /^#[0-9a-f]{6}$/i.test(o.colour) ? o.colour : null;
    if (tool === 'removebg' && colour) {
      const sharp = await sharpLib();
      if (sharp) { buf = await sharp(buf).flatten({ background: colour }).jpeg({ quality: 90 }).toBuffer(); mime = 'image/jpeg'; }
    }
    const made = await saveBuf(buf, mime, `${row.name} (${tool === 'removebg' ? (colour ? 'new background' : 'cut out') : `${scale}x`})`, { model });
    return { assets: [made], designs: TOOL_DESIGNS[tool], model };
  }

  // ---------- Read the words in a picture (for Edit text) ----------
  if (tool === 'readtext') {
    if (!hasClaude()) return fail('Reading text isn’t switched on (ANTHROPIC_API_KEY).', 'off', 501);
    const path = row.images?.email?.path || row.storage_path;
    const f = await repo.download(path);
    if (!f) return fail('Couldn’t read the file.', undefined, 500);
    const data = Buffer.from(await f.blob.arrayBuffer()).toString('base64');
    const text = await askClaude([
      { type: 'image', source: { type: 'base64', media_type: /png|webp|jpeg/.test(f.mime || '') ? f.mime : 'image/jpeg', data } },
      { type: 'text', text: 'List every separate piece of text visible in this image (headlines, body copy, prices, buttons, labels), each exactly as written, in reading order. Reply with JSON only: {"lines":["..."]}. If there is no text, {"lines":[]}.' },
    ], { maxTokens: 800 });
    const lines = (jsonFrom(text)?.lines || []).map((l: unknown) => String(l).trim()).filter(Boolean).slice(0, 30);
    return { assets: [], designs: 0, lines };
  }

  // ---------- AI edits with the image models ----------
  let prompt = '', aspect = aspectOf(row.width, row.height), refBufs: { mime: string; data: Buffer; label?: string }[] = [], refIds: string[] = [row.id];
  let purpose = 'product', name = row.name, extra: Record<string, unknown> = {};
  if (tool === 'erase') {
    const r = (o.rect || {}) as any;
    const rect = { x: Math.max(0, Math.min(1, Number(r.x))), y: Math.max(0, Math.min(1, Number(r.y))), w: Math.max(0.01, Math.min(1, Number(r.w))), h: Math.max(0.01, Math.min(1, Number(r.h))) };
    if (![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite)) return fail('Drag a box over what to remove.', 'bad', 400);
    const sharp = await sharpLib(); const src = await original();
    if (!sharp || !src) return fail('Couldn’t read the file.', undefined, 500);
    const img = sharp(src.buf).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true });
    const meta = await img.clone().png().toBuffer({ resolveWithObject: true });
    const W = meta.info.width, H = meta.info.height, sw = Math.max(4, Math.round(Math.min(W, H) / 160));
    const box = `<svg width="${W}" height="${H}"><rect x="${Math.round(rect.x * W)}" y="${Math.round(rect.y * H)}" width="${Math.round(rect.w * W)}" height="${Math.round(rect.h * H)}" fill="rgba(255,0,255,0.18)" stroke="#ff00ff" stroke-width="${sw}"/></svg>`;
    const marked = await sharp(meta.data).composite([{ input: Buffer.from(box) }]).png().toBuffer();
    refBufs = [{ mime: 'image/png', data: marked, label: 'the photo, with the area to remove marked in magenta' }]; refIds = [];
    prompt = 'Remove everything inside the magenta box marked on this image, and remove the magenta box itself. Fill that area so it blends seamlessly with its surroundings, as if nothing had been there. Keep everything outside the box exactly the same.';
    name = `${row.name} (erased)`; extra = { rect };
  } else if (tool === 'extend') {
    const s = EXTEND_SHAPES.find((x) => x.id === o.shape) || EXTEND_SHAPES[0];
    aspect = s.aspect;
    prompt = `Extend this exact image outward to fill a ${s.aspect} frame. Keep the original picture unchanged and in the middle; continue the background, surfaces and lighting naturally into the new space. Don't add text, logos or new objects. ${KEEP}`;
    name = `${row.name} (extended ${s.aspect})`;
  } else if (tool === 'edittext') {
    const edits = (Array.isArray(o.edits) ? o.edits : []).map((e: any) => ({ from: String(e?.from || '').slice(0, 300), to: String(e?.to ?? '').slice(0, 300) })).filter((e) => e.from && e.from !== e.to).slice(0, 12);
    if (!edits.length) return fail('Change at least one line of text.', 'bad', 400);
    prompt = `Change the text in this image:\n${edits.map((e) => (e.to ? `- "${e.from}" becomes "${e.to}"` : `- remove "${e.from}"`)).join('\n')}\nSet each new line in the same typeface, weight, size, colour, position and alignment as the text it replaces, spelled exactly as given. Change nothing else in the image.`;
    purpose = 'text'; name = `${row.name} (new words)`; extra = { edits };
  } else if (tool === 'smartresize') {
    const want = Array.isArray(o.sizes) ? SMART_SIZES.filter((s) => (o.sizes as unknown[]).includes(s.id)).slice(0, 10) : [];
    if (!want.length) return fail('Pick at least one size.', 'bad', 400);
    const out: ToolMade[] = []; let designs = 0, model: string | undefined;
    for (const s of want) {
      const r = await makeImages(repo, db, {
        wsId: o.wsId, userId: o.userId, referenceIds: [row.id], aspect: aspectOf(s.w, s.h), count: 1, purpose: 'product', onBoard: true, via: 'board-smartresize', extra: { size: { w: s.w, h: s.h }, label: s.label },
        prompt: `Recompose this exact image as a ${s.label} (${s.w}×${s.h}). Keep every element — the product, people, text and logo — unchanged, complete and legible. Rearrange the layout and extend the background so nothing important is cut off or squeezed. Don't add anything new.`,
        name: `${row.name} (${s.label})`,
      });
      if ('error' in r) { if (!out.length) return r; break; }
      designs += r.designs; model = r.model;
      for (const m of r.assets) {
        // Exactly the channel's size: the model works to the nearest shape.
        let made: ToolMade = { id: m.row.id, name: m.row.name, url: m.url, width: m.row.width ?? null, height: m.row.height ?? null, label: s.label };
        const f = await repo.download(m.row.storage_path!);
        if (f) {
          const e = await editImage(Buffer.from(await f.blob.arrayBuffer()), f.mime || 'image/png', { width: s.w, height: s.h });
          if (!('error' in e)) {
            await db.storage.from('assets').upload(m.row.storage_path!, e.buf, { contentType: e.mime, upsert: true });
            await db.from('assets').update({ width: e.width, height: e.height, bytes: e.buf.length, mime: e.mime }).eq('id', m.row.id);
            made = { ...made, url: await repo.signedUrl(m.row.storage_path!), width: e.width, height: e.height };
          }
        }
        out.push(made);
      }
    }
    return { assets: out, designs, model };
  }

  if (o.purpose === 'text' || o.purpose === 'product') purpose = String(o.purpose); // the model picked on the board
  const r = await makeImages(repo, db, { wsId: o.wsId, userId: o.userId, prompt, refBufs, referenceIds: refIds, aspect, count: 1, purpose, onBoard: true, name, via: `board-${tool}`, extra });
  if ('error' in r) return r;
  return { assets: r.assets.map((m) => ({ id: m.row.id, name: m.row.name, url: m.url, width: m.row.width ?? null, height: m.row.height ?? null })), designs: r.designs, model: r.model };
}
