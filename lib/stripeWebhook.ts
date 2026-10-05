// Stripe webhook signatures. Only the webhook route (Node runtime) imports this.
import crypto from 'node:crypto';

// Check the Stripe-Signature header (v1 scheme, 5 minute tolerance). Returns the event or null.
export function verifyWebhook(payload: string, header: string | null): any | null {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !header) return null;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]).filter((p) => p.length === 2 && p[0] !== 'v1'));
  const sigs = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300 || !sigs.length) return null;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  const ok = sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
  if (!ok) return null;
  try { return JSON.parse(payload); } catch { return null; }
}
