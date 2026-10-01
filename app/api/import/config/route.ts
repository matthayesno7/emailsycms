import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

// Which import sources are switched on (their keys are set on the server), and whether
// this user has connected Box. Public keys only; secrets never leave the server.
export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  let box: { connected: boolean; account?: string | null } = { connected: false };
  if (process.env.BOX_CLIENT_ID && process.env.BOX_CLIENT_SECRET) {
    const { data } = await createAdminClient().from('connections').select('account').eq('user_id', user.id).eq('provider', 'box').maybeSingle();
    box = { connected: !!data, account: data?.account || null };
  }
  return Response.json({
    dropbox: process.env.DROPBOX_APP_KEY ? { appKey: process.env.DROPBOX_APP_KEY } : null,
    google: process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_API_KEY
      ? { clientId: process.env.GOOGLE_CLIENT_ID, apiKey: process.env.GOOGLE_API_KEY, appId: process.env.GOOGLE_APP_ID || '' }
      : null,
    box: process.env.BOX_CLIENT_ID && process.env.BOX_CLIENT_SECRET ? box : null,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
