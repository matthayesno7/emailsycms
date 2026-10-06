import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { publicOrigin } from '@/lib/origin';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const origin = publicOrigin(request);
  const code = searchParams.get('code');
  // Supabase or Google can send an error back instead of a code: keep the reason so the sign-in page can show it.
  let why = searchParams.get('error_description') || searchParams.get('error') || (code ? '' : 'No sign-in code came back');
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) { why = error.message; console.error('[auth/callback]', error.message); }
    if (!error) {
      // Portal visitors (invite-list portals) go back to the portal and get no workspace of their own.
      const next = searchParams.get('next') || '';
      if (/^\/(p|s)\/[\w-]+(\/[\w-]+)?$/.test(next)) return NextResponse.redirect(`${origin}${next}`);
      await supabase.rpc('bootstrap');
      // From the landing page: /?site=…&plan=…&connect=… (nothing else is allowed through).
      if (/^\/\?(?:(?:site|plan|connect)=[^&#]*&?){1,3}$/.test(next)) return NextResponse.redirect(`${origin}${next}`);
      return NextResponse.redirect(`${origin}/`);
    }
  }
  if (why) console.error('[auth/callback] sign-in failed:', why);
  return NextResponse.redirect(`${origin}/login?error=link${why ? `&why=${encodeURIComponent(why.slice(0, 200))}` : ''}`);
}
