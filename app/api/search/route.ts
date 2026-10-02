import { createClient } from '@/lib/supabase/server';
import { searchAssets, type Filters } from '@/lib/search';

// AI search for the library.
// POST {workspace_id, q, filters?, understand?}
//   understand: let Claude turn a longer, plain-language query into filters first (the library
//   sends a fast search without it and a second one with it, then swaps in the better result).
// Returns ranked asset ids, the words searched and the filters applied (shown as chips).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const clean = (f: any): Filters => {
  if (!f || typeof f !== 'object') return {};
  const out: Filters = {};
  if (Array.isArray(f.kinds)) out.kinds = f.kinds.map(String).slice(0, 4);
  if (Array.isArray(f.colours)) out.colours = f.colours.map(String).slice(0, 4);
  if (['landscape', 'portrait', 'square'].includes(f.orientation)) out.orientation = f.orientation;
  if (typeof f.folder === 'string' && /^[0-9a-f-]{36}$/i.test(f.folder)) { out.folder = f.folder; out.folder_name = String(f.folder_name || '').slice(0, 60); }
  if (typeof f.on_brand === 'boolean') out.on_brand = f.on_brand;
  if (['uploaded', 'product_feed', 'generated'].includes(f.origin)) out.origin = f.origin;
  if (['draft', 'approved'].includes(f.status)) out.status = f.status;
  return out;
};

export async function POST(request: Request) {
  const t0 = Date.now();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const ws = String(body?.workspace_id || '');
  if (!/^[0-9a-f-]{36}$/i.test(ws)) return Response.json({ error: 'Workspace not found.' }, { status: 404 });
  const q = String(body?.q || '').slice(0, 300);
  try {
    const r = await searchAssets(supabase, { ws: [ws], q, filters: clean(body?.filters), understand: !!body?.understand, limit: 80 });
    return Response.json({ ...r, ms: Date.now() - t0 }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    // e.g. the search migration hasn't been run yet: the library falls back to keyword matching.
    return Response.json({ error: e?.message || 'Search failed.' }, { status: 500 });
  }
}
