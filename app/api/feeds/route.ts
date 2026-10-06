import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { readFeed, storeHost, syncFeed, type Feed } from '@/lib/feedSync';
import { allowedUrl } from '@/lib/net';
import { planOf } from '@/lib/billing';

// Product feeds that stay in sync: GET lists a brand's, POST adds one and syncs it straight away,
// PATCH { id } syncs again now, DELETE ?id stops syncing (the products stay).
export const runtime = 'nodejs';
export const maxDuration = 120;

async function who(ws: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: Response.json({ error: 'Sign in first.' }, { status: 401 }) };
  const { data } = await supabase.from('workspaces').select('id').eq('id', ws).maybeSingle();
  if (!data) return { error: Response.json({ error: 'Workspace not found.' }, { status: 404 }) };
  return { user, db: createAdminClient() };
}

export async function GET(request: Request) {
  const ws = new URL(request.url).searchParams.get('workspace_id') || '';
  const w = await who(ws);
  if ('error' in w) return w.error;
  const { data } = await w.db.from('product_feeds').select('id, kind, source, name, last_synced_at, last_status, last_count').eq('workspace_id', ws).order('created_at');
  const plan = (await planOf(w.db, ws)).plan;
  return Response.json({ feeds: data || [], daily: plan !== 'free' });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const ws = String(body?.workspace_id || '');
  const w = await who(ws);
  if ('error' in w) return w.error;
  const kind = body?.kind === 'shopify' ? 'shopify' : 'url';
  let source = String(body?.source || '').trim();
  if (kind === 'shopify') {
    const host = storeHost(source);
    if (!host) return Response.json({ error: 'Type your store’s address, like yourstore.com or yourstore.myshopify.com.' }, { status: 400 });
    source = host;
  } else {
    if (!/^https?:\/\//i.test(source)) source = `https://${source}`;
    if (!allowedUrl(source)) return Response.json({ error: 'That isn’t a public web address.' }, { status: 400 });
  }
  // Check it reads before saving it, so a bad link never becomes a feed that fails every day.
  const test = await readFeed(kind, source);
  if ('error' in test) return Response.json({ error: test.error }, { status: 400 });
  const name = kind === 'shopify' ? source : (() => { try { return new URL(source).host; } catch { return source; } })();
  const { data: feed, error } = await w.db.from('product_feeds')
    .upsert({ workspace_id: ws, kind, source, name, created_by: w.user.id }, { onConflict: 'workspace_id,kind,source' }).select('*').single();
  if (error || !feed) return Response.json({ error: error?.message || 'Couldn’t save the feed.' }, { status: 400 });
  const r = await syncFeed(w.db, feed as Feed, test);
  if ('error' in r) return Response.json({ error: r.error, feed }, { status: 400 });
  return Response.json({ feed: { ...feed, last_status: 'ok', last_count: r.count }, result: r });
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null);
  const ws = String(body?.workspace_id || '');
  const w = await who(ws);
  if ('error' in w) return w.error;
  const { data: feed } = await w.db.from('product_feeds').select('*').eq('id', String(body?.id || '')).eq('workspace_id', ws).maybeSingle();
  if (!feed) return Response.json({ error: 'Feed not found.' }, { status: 404 });
  const r = await syncFeed(w.db, feed as Feed);
  if ('error' in r) return Response.json({ error: r.error }, { status: 400 });
  return Response.json({ result: r });
}

export async function DELETE(request: Request) {
  const u = new URL(request.url);
  const ws = u.searchParams.get('workspace_id') || '';
  const w = await who(ws);
  if ('error' in w) return w.error;
  await w.db.from('product_feeds').delete().eq('id', u.searchParams.get('id') || '').eq('workspace_id', ws);
  return Response.json({ ok: true });
}
