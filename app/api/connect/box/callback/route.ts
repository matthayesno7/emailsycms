import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { publicOrigin } from '@/lib/origin';
import { cookies } from 'next/headers';

// Box sends the person back here with a code; swap it for tokens and keep them server-side.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const origin = publicOrigin(request);
  const url = new URL(request.url);
  const back = (msg: string) => Response.redirect(`${origin}/?import=box&result=${encodeURIComponent(msg)}`, 302);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.redirect(`${origin}/login`, 302);
  const jar = await cookies();
  const state = jar.get('box_oauth_state')?.value;
  jar.delete('box_oauth_state');
  if (!state || state !== url.searchParams.get('state')) return back('expired');
  const code = url.searchParams.get('code');
  if (!code) return back('cancelled');
  const res = await fetch('https://api.box.com/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: process.env.BOX_CLIENT_ID!, client_secret: process.env.BOX_CLIENT_SECRET!, redirect_uri: `${origin}/api/connect/box/callback` }),
  });
  if (!res.ok) return back('failed');
  const t = await res.json();
  let account: string | null = null;
  try {
    const me = await fetch('https://api.box.com/2.0/users/me', { headers: { authorization: `Bearer ${t.access_token}` } }).then((r) => r.json());
    account = me?.login || me?.name || null;
  } catch {}
  await createAdminClient().from('connections').upsert({
    user_id: user.id, provider: 'box', account, access_token: t.access_token, refresh_token: t.refresh_token,
    expires_at: new Date(Date.now() + (t.expires_in || 3600) * 1000).toISOString(), updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,provider' });
  return back('connected');
}
