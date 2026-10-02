import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { publicOrigin } from '@/lib/origin';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const origin = publicOrigin(request);
  const code = searchParams.get('code');
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Portal visitors (invite-list portals) go back to the portal and get no workspace of their own.
      const next = searchParams.get('next') || '';
      if (/^\/(p|s)\/[\w-]+(\/[\w-]+)?$/.test(next)) return NextResponse.redirect(`${origin}${next}`);
      await supabase.rpc('bootstrap');
      return NextResponse.redirect(`${origin}/`);
    }
  }
  return NextResponse.redirect(`${origin}/login?error=link`);
}
