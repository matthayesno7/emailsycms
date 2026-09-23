import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import Library from '@/components/Library';

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');
  await supabase.rpc('bootstrap');
  return <Library userId={user.id} email={user.email || ''} appUrl={(process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '')} />;
}
