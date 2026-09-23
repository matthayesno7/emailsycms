import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { publicOrigin } from '@/lib/origin';

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;
  const open = path.startsWith('/login') || path.startsWith('/auth');
  if (!user && !open) {
    return NextResponse.redirect(`${publicOrigin(request)}/login`);
  }
  return response;
}

export const config = {
  // The MCP endpoint and health check authenticate themselves; skip them here.
  matcher: ['/((?!api/mcp|api/health|_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
