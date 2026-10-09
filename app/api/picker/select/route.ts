import { createAdminClient } from '@/lib/supabase/admin';
import { loadPicker, originAllowed, pickable, pickedAsset, PICK_COLS, tooBusy, withTokens } from '@/lib/integrations';

// The assets someone picked, with permanent links the embedding tool can store.
// POST { key, ids: string[], origin } → { assets: PickedAsset[] }
// origin is the page the picker is embedded in; it must be one of the key's allowed sites
// (the picker only sends results to that page).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const b = await request.json().catch(() => null);
  const ctx = await loadPicker(b?.key);
  if ('error' in ctx) return Response.json({ error: ctx.error === 'plan' ? 'This brand isn’t on Pro or Enterprise, so its picker is off.' : 'This picker key isn’t valid or has been turned off.' }, { status: 403 });
  if (tooBusy(ctx.key.id)) return Response.json({ error: 'Too many requests. Try again in a minute.' }, { status: 429 });
  const test = b?.origin === 'test';
  if (!test && !originAllowed(b?.origin, ctx.key.origins)) return Response.json({ error: 'This site isn’t allowed to use this picker.' }, { status: 403 });
  const ids = (Array.isArray(b?.ids) ? b.ids : []).filter((x: unknown) => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)).slice(0, 50);
  if (!ids.length) return Response.json({ error: 'Pick at least one file.' }, { status: 400 });

  const { data } = await ctx.db.from('assets').select(PICK_COLS).eq('workspace_id', ctx.ws.id).in('id', ids);
  const rows = (data || []).filter(pickable);
  if (!rows.length) return Response.json({ error: 'Those files aren’t available any more.' }, { status: 404 });
  await withTokens(ctx.db, rows);
  const order = new Map<string, number>(ids.map((id: string, i: number) => [id, i] as [string, number]));
  const assets = rows.filter((a) => a.public_token).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)).map((a) => pickedAsset(a, ctx.ws.name));

  // Who used what, when: the key's last use, and one line in the activity log per pick.
  const db = createAdminClient();
  await db.from('integration_keys').update({ last_used_at: new Date().toISOString() }).eq('id', ctx.key.id);
  if (!test) {
    await db.rpc('audit', {
      p_ws: ctx.ws.id, p_action: 'integration.picked', p_type: 'integration', p_id: ctx.key.id, p_name: ctx.key.name,
      p_details: { assets: assets.map((a) => a.name).slice(0, 20), count: assets.length, site: String(b.origin).slice(0, 200) },
    }).then(() => {}, () => {});
  }
  return Response.json({ assets }, { headers: { 'Cache-Control': 'no-store' } });
}
