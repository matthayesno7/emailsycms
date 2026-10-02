import { createClient } from '@/lib/supabase/server';
import { allowed, loadPortalById } from '@/lib/share';
import { publicOrigin } from '@/lib/origin';

// Sign-in for allowlist portals: emails a magic link, but only to addresses on the list.
// POST {p: portal id, email}
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const b = await request.json().catch(() => ({}));
  const email = String(b?.email || '').trim().toLowerCase().slice(0, 200);
  const r = b?.p ? await loadPortalById(String(b.p)) : null;
  if (!r || r.portal.access !== 'allowlist' || !r.portal.published) return Response.json({ error: 'This portal isn’t available.' }, { status: 404 });
  // Same answer either way, so the page doesn't reveal who's on the list.
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(email)) return Response.json({ error: 'Enter your email address.' }, { status: 400 });
  if (allowed(r.portal.allowlist, email)) {
    const supabase = await createClient();
    const next = `/p/${r.ws.slug}/${r.portal.slug}`;
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${publicOrigin(request)}/auth/callback?next=${encodeURIComponent(next)}`, shouldCreateUser: true } });
    if (error) return Response.json({ error: /rate limit/i.test(error.message) ? 'Too many sign-in emails just now. Try again in a little while.' : 'Couldn’t send the email. Try again.' }, { status: 429 });
  }
  return Response.json({ ok: true });
}
