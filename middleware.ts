import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { publicOrigin } from '@/lib/origin';

// The picker is embedded in other tools: only the sites on its key may frame it.
// (Looked up straight from the database's REST API, so this works in the middleware runtime.)
async function pickerSites(key: string): Promise<string[]> {
  if (!/^mpk_[A-Za-z0-9_-]{32}$/.test(key) || !process.env.SUPABASE_SERVICE_ROLE_KEY) return [];
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const r = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/integration_keys?select=origins&revoked_at=is.null&key_hash=eq.${hash}`, {
    headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
    cache: 'no-store',
  }).catch(() => null);
  const rows = r?.ok ? ((await r.json().catch(() => [])) as { origins: string[] }[]) : [];
  return (rows[0]?.origins || []).filter((o) => /^https?:\/\/(\*\.)?[a-z0-9.-]+(:\d+)?$/.test(o));
}

export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname === '/picker') {
    const sites = await pickerSites(request.nextUrl.searchParams.get('key') || '');
    const res = NextResponse.next({ request });
    res.headers.set('Content-Security-Policy', `frame-ancestors 'self' ${sites.join(' ')}`.trim());
    res.headers.set('Referrer-Policy', 'no-referrer');
    return res;
  }
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
  const open = path.startsWith('/login') || path.startsWith('/auth') || path === '/terms' || path === '/privacy' || path === '/security' || path === '/dpa' || path === '/help' || path.startsWith('/help/');
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
  // Public pages (share links /s, portals /p), permanent asset links (/a) and the picker's API check access themselves.
  matcher: ['/((?!api/mcp|api/health|api/billing/webhook|api/public|api/picker|a/|s/|p/|\.well-known|_next/static|_next/image|mise.js|favicon.ico|favicon.svg|icon.svg|icon-\\d+\\.png|apple-touch-icon.png|site.webmanifest).*)'],
};
