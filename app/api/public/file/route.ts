import { NextResponse } from 'next/server';
import { FORMATS, fileUrl, logEvent, publicContext, type Format } from '@/lib/share';

// A file from a share link or portal: GET ?s=<token> or ?p=<portal id>, &a=<asset id>&f=<format>[&dl=1]
// Checks the link or portal is live, the visitor may open it, and the asset is part of it;
// then redirects to a two-minute signed URL. Downloads are counted.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const u = new URL(request.url);
  const ctx = await publicContext({ s: u.searchParams.get('s'), p: u.searchParams.get('p') });
  if (!ctx) return new NextResponse('This link isn’t available.', { status: 404 });
  const a = ctx.assets.find((x) => x.id === u.searchParams.get('a'));
  if (!a) return new NextResponse('Not found.', { status: 404 });
  const dl = u.searchParams.get('dl') === '1';
  const f = (FORMATS as readonly string[]).includes(u.searchParams.get('f') || '') ? (u.searchParams.get('f') as Format) : 'original';
  if (dl && !ctx.member && (!ctx.allow_download || !ctx.formats.includes(f))) return new NextResponse('Downloads are off for this link.', { status: 403 });
  const url = await fileUrl(ctx.db, a, f, dl);
  if (!url) return new NextResponse('Couldn’t open the file.', { status: 500 });
  if (dl && !ctx.member) await logEvent(ctx.db, { workspace_id: ctx.workspace_id, share_id: ctx.share_id, portal_id: ctx.portal_id, asset_id: a.id, event: 'download', email: ctx.email, format: f }).catch(() => {});
  return NextResponse.redirect(url, { headers: { 'Cache-Control': 'no-store' } });
}
