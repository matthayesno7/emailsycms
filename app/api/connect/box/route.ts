import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { publicOrigin } from '@/lib/origin';
import { cookies } from 'next/headers';

// Start connecting Box: send the person to Box to approve read access.
// DELETE disconnects.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const origin = publicOrigin(request);
  if (!user) return Response.redirect(`${origin}/login`, 302);
  if (!process.env.BOX_CLIENT_ID) return new Response('Box isn’t set up on this server yet.', { status: 501 });
  const state = crypto.randomUUID();
  (await cookies()).set('box_oauth_state', state, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 600, path: '/' });
  const u = new URL('https://account.box.com/api/oauth2/authorize');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', process.env.BOX_CLIENT_ID);
  u.searchParams.set('redirect_uri', `${origin}/api/connect/box/callback`);
  u.searchParams.set('state', state);
  return Response.redirect(u.toString(), 302);
}

export async function DELETE() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  await createAdminClient().from('connections').delete().eq('user_id', user.id).eq('provider', 'box');
  return Response.json({ ok: true });
}
