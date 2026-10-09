import { createAdminClient } from '@/lib/supabase/admin';
import { needRole } from '@/lib/roleAuth';
import { planOf } from '@/lib/billing';
import { newPickerKey, normaliseSite } from '@/lib/integrations';

// Integration keys for the Mise picker (Settings › Integrations). Admins and owners; Pro and Enterprise.
// GET ?workspace_id=…                         the brand's keys (never the key itself)
// POST {workspace_id, name, sites[]}          a new key, returned once
// PATCH {workspace_id, id, sites?, off?}      change the allowed sites, or turn a key off
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const COLS = 'id, name, key_prefix, origins, created_at, last_used_at, revoked_at';

function sitesFrom(raw: unknown) {
  const list = (Array.isArray(raw) ? raw : String(raw || '').split(/[\s,]+/)).map((s) => String(s)).filter((s) => s.trim());
  const ok = [...new Set(list.map(normaliseSite).filter((s): s is string => !!s))].slice(0, 20);
  const bad = list.filter((s) => !normaliseSite(s));
  return { ok, bad };
}
const planError = () => Response.json({ error: 'Integrations are on Pro. Upgrade this brand to use the Mise picker in other tools.', code: 'plan' }, { status: 402 });

export async function GET(request: Request) {
  const ws = new URL(request.url).searchParams.get('workspace_id') || '';
  const who = await needRole(ws, 'admin');
  if ('error' in who) return who.error;
  const db = createAdminClient();
  const { data } = await db.from('integration_keys').select(COLS).eq('workspace_id', ws).order('created_at', { ascending: false });
  return Response.json({ keys: data || [], plan: (await planOf(db, ws)).plan });
}

export async function POST(request: Request) {
  const b = await request.json().catch(() => null);
  const ws = String(b?.workspace_id || '');
  const who = await needRole(ws, 'admin');
  if ('error' in who) return who.error;
  const db = createAdminClient();
  if ((await planOf(db, ws)).plan === 'free') return planError();
  const name = String(b?.name || '').trim().slice(0, 60);
  if (!name) return Response.json({ error: 'Give it a name, like “Bloomreach”.' }, { status: 400 });
  const { ok, bad } = sitesFrom(b?.sites);
  if (bad.length) return Response.json({ error: `“${bad[0]}” isn’t a website address. Use something like https://app.example.com or *.example.com.` }, { status: 400 });
  if (!ok.length) return Response.json({ error: 'Add at least one site that will show the picker.' }, { status: 400 });
  const { count } = await db.from('integration_keys').select('id', { count: 'exact', head: true }).eq('workspace_id', ws).is('revoked_at', null);
  if ((count || 0) >= 20) return Response.json({ error: 'A brand can have up to 20 keys. Turn off ones you no longer use.' }, { status: 400 });
  const k = newPickerKey();
  const { data, error } = await db.from('integration_keys').insert({ workspace_id: ws, name, key_prefix: k.prefix, key_hash: k.hash, origins: ok, created_by: who.user.id }).select(COLS).single();
  if (error) return Response.json({ error: 'Couldn’t create the key. Try again.' }, { status: 500 });
  return Response.json({ key: k.key, row: data });
}

export async function PATCH(request: Request) {
  const b = await request.json().catch(() => null);
  const ws = String(b?.workspace_id || '');
  const who = await needRole(ws, 'admin');
  if ('error' in who) return who.error;
  const db = createAdminClient();
  const patch: Record<string, any> = { changed_by: who.user.id };
  if (b?.off) patch.revoked_at = new Date().toISOString();
  else {
    if ((await planOf(db, ws)).plan === 'free') return planError();
    const { ok, bad } = sitesFrom(b?.sites);
    if (bad.length) return Response.json({ error: `“${bad[0]}” isn’t a website address.` }, { status: 400 });
    if (!ok.length) return Response.json({ error: 'Add at least one site.' }, { status: 400 });
    patch.origins = ok;
  }
  const { data, error } = await db.from('integration_keys').update(patch).eq('id', String(b?.id || '')).eq('workspace_id', ws).select(COLS).maybeSingle();
  if (error || !data) return Response.json({ error: 'Couldn’t change that key.' }, { status: 404 });
  return Response.json({ row: data });
}
