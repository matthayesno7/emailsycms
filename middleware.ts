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
  const open = path.startsWith('/login') || path.startsWith('/auth') || path === '/terms' || path === '/privacy' || path === '/help' || path.startsWith('/help/');
  if (!user && !open) {
    // Keep what the landing page asked for (?site=, ?plan=, ?connect=) through sign-in.
    const keep = new URLSearchParams();
    for (const k of ['site', 'plan', 'connect']) { const v = request.nextUrl.searchParams.get(k); if (v) keep.set(k, v.slice(0, 200)); }
    return NextResponse.redirect(`${publicOrigin(request)}/login${keep.toString() ? `?${keep}` : ''}`);
  }
  return response;
}

export const config = {
  // The MCP endpoint and health check authenticate themselves; skip them here. Stripe's webhook is checked by its signature.
  // .well-known is skipped so Claude's OAuth discovery gets a plain 404 (no sign-in needed), not a login redirect.
  // Public pages (share links /s, portals /p) and their API check access themselves.
  matcher: ['/((?!api/mcp|api/health|api/billing/webhook|api/public|s/|p/|\.well-known|_next/static|_next/image|favicon.ico|favicon.svg|icon.svg|icon-\\d+\\.png|apple-touch-icon.png|site.webmanifest).*)'],
};
