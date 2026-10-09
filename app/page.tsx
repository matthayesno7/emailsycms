import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { headers } from 'next/headers';
import Library from '@/components/Library';
import { onSignIn } from '@/lib/emails/send';

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await supabase.rpc('bootstrap');
  // Sign-ins that skip /auth/callback still get their welcome (once; does nothing for existing accounts).
  void onSignIn(user.id, (await headers()).get('cf-ipcountry'));
  return <Library userId={user.id} email={user.email || ''} appUrl={(process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')} />;
}
