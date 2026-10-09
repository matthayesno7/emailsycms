import { loadPicker, pickable, PICK_COLS, PICK_KINDS, tooBusy } from '@/lib/integrations';
import { thumbUrls } from '@/lib/share';
import { searchAssets } from '@/lib/search';

// The picker's library: approved, available assets in the key's brand.
// GET ?key=…&q=…&type=image|logo|product|video|all&types=image,logo,product&offset=0
// "types" is what the embedding tool allows; "type" is the tab the person chose.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const PAGE = 48;

export async function GET(request: Request) {
  const u = new URL(request.url);
  const ctx = await loadPicker(u.searchParams.get('key'));
  if ('error' in ctx) return Response.json({ error: ctx.error === 'plan' ? 'This brand isn’t on Pro or Enterprise, so its picker is off.' : 'This picker key isn’t valid or has been turned off.' }, { status: 403 });
  if (tooBusy(ctx.key.id)) return Response.json({ error: 'Too many requests. Try again in a minute.' }, { status: 429 });

  const allowed = (u.searchParams.get('types') || 'image,logo,product').split(',').filter((t): t is (typeof PICK_KINDS)[number] => (PICK_KINDS as readonly string[]).includes(t));
  const tab = u.searchParams.get('type') || 'all';
  const kinds = (tab !== 'all' && (allowed as string[]).includes(tab) ? [tab] : allowed.length ? allowed : ['image', 'logo', 'product']) as string[];
  const q = (u.searchParams.get('q') || '').trim().slice(0, 200);
  const offset = Math.max(0, Math.min(5000, Number(u.searchParams.get('offset')) || 0));

  let rows: any[] = [];
  let more = false;
  if (q) {
    // Words and meaning, as in the app. One page of the best matches.
    const r = await searchAssets(ctx.db, { ws: [ctx.ws.id], q, filters: { kinds: kinds as any }, limit: 120 }).catch(() => null);
    const ids = (r?.hits || []).map((h) => h.id);
    if (ids.length) {
      const { data } = await ctx.db.from('assets').select(PICK_COLS).eq('workspace_id', ctx.ws.id).in('id', ids);
      const order = new Map(ids.map((id, i) => [id, i]));
      rows = (data || []).filter(pickable).sort((a: any, b: any) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    }
  } else {
    const { data } = await ctx.db.from('assets').select(PICK_COLS).eq('workspace_id', ctx.ws.id).in('kind', kinds).neq('status', 'draft')
      .not('storage_path', 'is', null).order('created_at', { ascending: false }).range(offset, offset + PAGE);
    more = (data || []).length > PAGE;
    rows = (data || []).slice(0, PAGE).filter(pickable);
  }

  const thumbs = await thumbUrls(ctx.db, rows);
  return Response.json({
    brand: ctx.ws.name,
    more, next: offset + PAGE,
    assets: rows.map((a) => ({
      id: a.id, name: a.name, type: a.kind, mime: a.mime, width: a.width, height: a.height,
      thumb: thumbs[a.id] || '', alt: a.fields?.alt || a.description || a.name,
      pid: a.pid || null, price: a.fields?.price || a.price || null,
    })),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
