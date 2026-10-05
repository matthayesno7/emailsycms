import { createAdminClient } from '@/lib/supabase/admin';
import { whoFor } from '@/lib/billingAuth';
import { billingRow } from '@/lib/billing';
import { hasStripe, stripe } from '@/lib/stripe';
import { publicOrigin } from '@/lib/origin';

// Stripe's customer portal for a brand: change monthly/yearly, card, invoices, VAT number, cancel.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!hasStripe()) return Response.json({ error: 'Billing isn’t switched on yet.' }, { status: 501 });
  const b = await request.json().catch(() => null);
  const who = await whoFor(String(b?.workspace_id || ''));
  if (!who.user) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  if (who.role !== 'owner') return Response.json({ error: 'Only owners can manage billing.' }, { status: 403 });
  const row = await billingRow(createAdminClient(), who.ws!.id);
  if (!row?.stripe_customer_id) return Response.json({ error: 'This brand has no billing yet.' }, { status: 404 });
  try {
    const s = await stripe('POST', '/billing_portal/sessions', { customer: row.stripe_customer_id, configuration: process.env.STRIPE_PORTAL_CONFIG || undefined, return_url: `${publicOrigin(request)}/?billing=portal&ws=${who.ws!.id}`, locale: 'en-GB' });
    return Response.json({ url: s.url });
  } catch (e: any) {
    console.error('[billing] portal', e?.message);
    return Response.json({ error: 'Couldn’t open billing. Try again in a moment.' }, { status: 502 });
  }
}
