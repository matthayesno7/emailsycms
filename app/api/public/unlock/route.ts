import { checkPasscode, loadPortalById, loadShare, setUnlocked, tooManyAttempts } from '@/lib/share';

// Passcode for a share link (s) or portal (p). Right passcode: an unlock cookie for 30 days.
export const runtime = 'nodejs';

export async function POST(request: Request) {
  const b = await request.json().catch(() => ({}));
  const passcode = String(b?.passcode || '').slice(0, 100);
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  if (b?.s) {
    const r = await loadShare(String(b.s));
    if (!r || !r.share.passcode_hash) return Response.json({ error: 'This link isn’t available.' }, { status: 404 });
    if (tooManyAttempts(`s:${r.share.id}:${ip}`)) return Response.json({ error: 'Too many tries. Wait a minute and try again.' }, { status: 429 });
    if (!checkPasscode(passcode, r.share.passcode_hash)) return Response.json({ error: 'That passcode isn’t right.' }, { status: 403 });
    await setUnlocked('s', r.share.id, r.share.passcode_hash, '/');
    return Response.json({ ok: true });
  }
  if (b?.p) {
    const r = await loadPortalById(String(b.p));
    if (!r || r.portal.access !== 'passcode' || !r.portal.passcode_hash) return Response.json({ error: 'This portal isn’t available.' }, { status: 404 });
    if (tooManyAttempts(`p:${r.portal.id}:${ip}`)) return Response.json({ error: 'Too many tries. Wait a minute and try again.' }, { status: 429 });
    if (!checkPasscode(passcode, r.portal.passcode_hash)) return Response.json({ error: 'That passcode isn’t right.' }, { status: 403 });
    await setUnlocked('p', r.portal.id, r.portal.passcode_hash, '/');
    return Response.json({ ok: true });
  }
  return Response.json({ error: 'Missing link.' }, { status: 400 });
}
