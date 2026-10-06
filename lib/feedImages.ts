// Downloads product images from feed image links into storage, a batch at a time.
// Used by the CSV import (the browser calls /api/feed-images) and by synced feeds (the server).
import { imageSize } from './imageSize';
import { allowedUrl, fetchLimited, IMAGE_EXT } from './net';

const MAX_BYTES = 25 * 1024 * 1024;

export async function feedImageBatch(db: any, ws: string, skip: string[] = [], batchSize = 12) {
  const { data: rows, error } = await db.from('assets').select('id, pid, name, feed_image')
    .eq('workspace_id', ws).eq('kind', 'product').is('storage_path', null)
    .not('feed_image', 'is', null).neq('feed_image', '').limit(500);
  if (error) return { error: error.message as string };
  const todo = (rows || []).filter((r: any) => !skip.includes(r.id));
  const batch = todo.slice(0, batchSize);
  let limit = false;
  const results = await Promise.all(batch.map(async (r: any) => {
    const url = allowedUrl(r.feed_image);
    if (!url) return { id: r.id, pid: r.pid, error: 'Bad image link' };
    const got = await fetchLimited(url, { accept: 'image/*', maxBytes: MAX_BYTES, ua: 'MiseCMS/1.0 (+product feed import)' });
    if ('error' in got) return { id: r.id, pid: r.pid, error: got.error === 'Too large' ? 'Over 25 MB' : got.error };
    if (!got.type.startsWith('image/')) return { id: r.id, pid: r.pid, error: `Not an image (${got.type || 'unknown'})` };
    const path = `${ws}/products/${crypto.randomUUID()}.${IMAGE_EXT[got.type] || 'jpg'}`;
    const up = await db.storage.from('assets').upload(path, got.buf, { contentType: got.type });
    if (up.error) return { id: r.id, pid: r.pid, error: up.error.message };
    const size = imageSize(got.buf);
    const { error: e2 } = await db.from('assets').update({ storage_path: path, mime: got.type, bytes: got.buf.length, width: size?.w ?? null, height: size?.h ?? null }).eq('id', r.id);
    if (e2) {
      await db.storage.from('assets').remove([path]);
      if (/FREE_FILE_LIMIT/.test(e2.message)) limit = true;
      return { id: r.id, pid: r.pid, error: e2.message };
    }
    return { id: r.id, pid: r.pid, ok: true };
  }));
  const failed = results.filter((r) => !r.ok);
  return { done: results.filter((r) => r.ok).length, failed, remaining: Math.max(0, todo.length - batch.length), limit };
}
