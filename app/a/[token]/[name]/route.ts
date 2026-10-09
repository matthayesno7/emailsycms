import { createAdminClient } from '@/lib/supabase/admin';
import { planOf } from '@/lib/billing';
import { pickable, PICK_COLS } from '@/lib/integrations';

// A permanent link to an asset: /a/<token>/<name>.<ext>[?f=email | ?w=<width>]
// Serves the current version for as long as the asset is approved and available and the brand is on
// Pro or Enterprise. Archived, expired, obsolete or deleted files stop at once (410), so a campaign
// can't keep showing a photo whose licence has run out. Cached by browsers and the CDN for up to an hour.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const gone = (status: number, msg: string) => new Response(msg, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=60', 'Access-Control-Allow-Origin': '*' } });

async function serve(request: Request, token: string, head: boolean) {
  if (!/^[A-Za-z0-9_-]{20,30}$/.test(token)) return gone(404, 'Not found.');
  const db = createAdminClient();
  const { data: a } = await db.from('assets').select(PICK_COLS).eq('public_token', token).maybeSingle();
  if (!a) return gone(404, 'Not found.');
  if (!pickable(a)) return gone(410, 'This file is no longer available.');
  if ((await planOf(db, a.workspace_id)).plan === 'free') return gone(410, 'This file is no longer available.');

  const u = new URL(request.url);
  const resizable = /^image\/(png|jpeg|webp)$/.test(a.mime || '');
  const w = Math.round(Number(u.searchParams.get('w')));
  let signed: string | null = null;
  if (u.searchParams.get('f') === 'email' && a.images?.email?.path) {
    signed = (await db.storage.from('assets').createSignedUrl(a.images.email.path, 120)).data?.signedUrl || null;
  } else if (resizable && w >= 50 && w <= 3000 && w < (a.width || Infinity)) {
    signed = (await db.storage.from('assets').createSignedUrl(a.storage_path, 120, { transform: { width: w, resize: 'contain' } })).data?.signedUrl || null;
  }
  if (!signed) signed = (await db.storage.from('assets').createSignedUrl(a.storage_path, 120)).data?.signedUrl || null;
  if (!signed) return gone(502, 'Couldn’t open the file.');

  // Videos can be large: hand them straight to storage. Images are streamed through, so the link
  // itself returns the image (some tools don't follow redirects) and can be cached.
  if (a.kind === 'video') return Response.redirect(signed, 302);
  const range = request.headers.get('range');
  const up = await fetch(signed, { method: head ? 'HEAD' : 'GET', headers: range ? { range } : {} });
  if (!up.ok && up.status !== 206) return gone(502, 'Couldn’t open the file.');
  const h = new Headers({
    'Content-Type': up.headers.get('content-type') || a.mime || 'application/octet-stream',
    'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': 'inline',
  });
  for (const k of ['content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) { const v = up.headers.get(k); if (v) h.set(k, v); }
  return new Response(head ? null : up.body, { status: up.status, headers: h });
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string; name: string }> }) {
  return serve(request, (await params).token, false);
}
export async function HEAD(request: Request, { params }: { params: Promise<{ token: string; name: string }> }) {
  return serve(request, (await params).token, true);
}
