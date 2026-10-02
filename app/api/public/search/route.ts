import { publicContext } from '@/lib/share';
import { searchAssets } from '@/lib/search';

// Search inside a portal or share link: the same AI search as the app, limited to what it shares.
// POST {p: portal id | s: token, q}
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const b = await request.json().catch(() => ({}));
  const q = String(b?.q || '').trim().slice(0, 200);
  if (!q) return Response.json({ ids: [] });
  const ctx = await publicContext({ s: b?.s ? String(b.s) : null, p: b?.p ? String(b.p) : null });
  if (!ctx) return Response.json({ error: 'Not available.' }, { status: 404 });
  const allowed = new Set(ctx.assets.map((a) => a.id));
  try {
    const r = await searchAssets(ctx.db, { ws: [ctx.workspace_id], q, understand: q.split(/\s+/).length >= 3, limit: 200 });
    return Response.json({ ids: r.hits.map((h) => h.id).filter((id) => allowed.has(id)) });
  } catch {
    return Response.json({ ids: null }); // the page falls back to matching names and tags
  }
}
