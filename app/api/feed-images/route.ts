import { createClient } from '@/lib/supabase/server';
import { imageSize } from '@/lib/imageSize';

// Downloads product images from a feed's image_link URLs into storage.
// The browser can't do this itself (other sites block cross-origin reads), so the server fetches them.
// Handles a batch per call; the client calls again while `remaining` > 0.

export const runtime = 'nodejs';
export const maxDuration = 60;

const BATCH = 12;
const MAX_BYTES = 25 * 1024 * 1024;

function allowedUrl(raw: string) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const h = u.hostname.toLowerCase();
    // No local or private network addresses.
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h.includes(':') || h === '[::1]') return null;
    return u;
  } catch {
    return null;
  }
}

async function fetchImage(url: URL) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(url, { signal: ctl.signal, redirect: 'follow', headers: { 'user-agent': 'EmailsyCMS/1.0 (+product feed import)', accept: 'image/*' } });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!type.startsWith('image/')) return { error: `Not an image (${type || 'unknown'})` };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) return { error: 'Over 25 MB' };
    return { buf, type };
  } catch (e: any) {
    return { error: e?.name === 'AbortError' ? 'Timed out' : 'Could not download' };
  } finally {
    clearTimeout(timer);
  }
}

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif' };

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const ws = String(body?.workspace_id || '');
  const skip: string[] = Array.isArray(body?.skip) ? body.skip.map(String).slice(0, 5000) : [];
  if (!ws) return Response.json({ error: 'Missing workspace.' }, { status: 400 });

  // Row level security limits this to workspaces the user belongs to.
  const { data: rows, error } = await supabase
    .from('assets')
    .select('id, pid, name, feed_image')
    .eq('workspace_id', ws)
    .eq('kind', 'product')
    .is('storage_path', null)
    .not('feed_image', 'is', null)
    .neq('feed_image', '')
    .limit(500);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  const todo = (rows || []).filter((r) => !skip.includes(r.id));
  const batch = todo.slice(0, BATCH);

  const results = await Promise.all(batch.map(async (r) => {
    const url = allowedUrl(r.feed_image);
    if (!url) return { id: r.id, pid: r.pid, error: 'Bad image link' };
    const img = await fetchImage(url);
    if (!img.buf) return { id: r.id, pid: r.pid, error: img.error };
    const ext = EXT[img.type] || 'jpg';
    const path = `${ws}/products/${crypto.randomUUID()}.${ext}`;
    const up = await supabase.storage.from('assets').upload(path, img.buf, { contentType: img.type });
    if (up.error) return { id: r.id, pid: r.pid, error: up.error.message };
    const size = imageSize(img.buf);
    const { error: e2 } = await supabase.from('assets').update({ storage_path: path, mime: img.type, bytes: img.buf.length, width: size?.w ?? null, height: size?.h ?? null }).eq('id', r.id);
    if (e2) return { id: r.id, pid: r.pid, error: e2.message };
    return { id: r.id, pid: r.pid, ok: true };
  }));

  const done = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  return Response.json({ done, failed, remaining: Math.max(0, todo.length - batch.length) });
}
