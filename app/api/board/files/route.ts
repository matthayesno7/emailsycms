import { safe } from '@/lib/safeRoute';
import { member } from '@/lib/makeAuth';
import { uploadEmailCopy } from '@/lib/uploadEmailCopy';

// Files that live on a Create board until someone saves them (assets.on_board).
// POST { workspace_id, action, ... }
//   rows    { asset_ids }           the board's own files, with links to show them
//   add     { storage_path, mime, width, height, bytes, name, from? }   a file edited in the browser (already uploaded)
//   keep    { asset_ids }           save to the library (AI-made files go to Review as drafts)
//   discard { asset_ids }           taken off the board without saving: deleted
export const runtime = 'nodejs';
export const maxDuration = 60;

const ids = (v: unknown) => (Array.isArray(v) ? v : []).map(String).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 200);
const COLS = 'id, workspace_id, kind, name, storage_path, mime, width, height, bytes, images, status, origin, on_board, focus, fields, provenance, pid, price, link, lifecycle';

export const POST = safe('board/files', async (request: Request) => {
  const b = await request.json().catch(() => null);
  const ws = String(b?.workspace_id || '');
  const m = await member(ws, b?.action === 'rows' ? 'any' : 'add');
  if ('error' in m) return m.error;
  const { db, repo, user } = m;

  if (b.action === 'rows') {
    const list = ids(b.asset_ids);
    if (!list.length) return Response.json({ rows: [], urls: {} });
    const { data } = await db.from('assets').select(COLS).eq('workspace_id', ws).in('id', list);
    const urls: Record<string, string> = {};
    for (const r of (data || []) as any[]) {
      for (const p of [r.storage_path, r.images?.email?.path].filter(Boolean)) { const u = await repo.signedUrl(p); if (u) urls[p] = u; }
    }
    return Response.json({ rows: data || [], urls });
  }

  if (b.action === 'add') {
    const path = String(b.storage_path || '');
    if (!path.startsWith(`${ws}/`) || path.includes('..')) return Response.json({ error: 'That file isn’t in this brand.' }, { status: 400 });
    const from = typeof b.from === 'string' && /^[0-9a-f-]{36}$/i.test(b.from) ? b.from : null;
    const row = await repo.insertAsset({
      workspace_id: ws, kind: 'image', name: String(b.name || 'Edited image').slice(0, 120), storage_path: path,
      mime: String(b.mime || 'image/png'), width: Number(b.width) || null, height: Number(b.height) || null, bytes: Number(b.bytes) || null,
      origin: 'generated', status: 'draft', created_by: user.id, fields: {}, on_board: true,
      provenance: { via: 'board-edit', edit: String(b.edit || '').slice(0, 120) || null, source_asset_ids: from ? [from] : [], generated_at: new Date().toISOString() },
      figma: null,
    } as any);
    return Response.json({ row, url: await repo.signedUrl(path) });
  }

  if (b.action === 'keep') {
    const list = ids(b.asset_ids);
    const { data } = await db.from('assets').select(COLS).eq('workspace_id', ws).eq('on_board', true).in('id', list);
    const kept: string[] = [];
    for (const r of (data || []) as any[]) {
      let images = r.images || {};
      // The email-ready copy the library expects, made now that the file is staying.
      if (!images.email && r.storage_path && /^image\//.test(r.mime || '') && !/svg|gif/.test(r.mime || '')) {
        const file = await repo.download(r.storage_path);
        if (file) images = { ...images, ...(await uploadEmailCopy(db, ws, Buffer.from(await file.blob.arrayBuffer()), r.mime)) };
      }
      const { error } = await db.from('assets').update({ on_board: false, images }).eq('id', r.id);
      if (!error) kept.push(r.id);
    }
    return Response.json({ kept });
  }

  if (b.action === 'discard') {
    const list = ids(b.asset_ids);
    const { data } = await db.from('assets').select('id, storage_path, images').eq('workspace_id', ws).eq('on_board', true).in('id', list);
    const rows = (data || []) as any[];
    const paths = rows.flatMap((r) => [r.storage_path, r.images?.email?.path].filter(Boolean));
    if (paths.length) await db.storage.from('assets').remove(paths);
    if (rows.length) await db.from('assets').delete().in('id', rows.map((r) => r.id));
    return Response.json({ discarded: rows.map((r) => r.id) });
  }
  return Response.json({ error: 'Unknown action.' }, { status: 400 });
});
