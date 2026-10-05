import { createAdminClient } from '@/lib/supabase/admin';
import { whoFor } from '@/lib/billingAuth';
import { billingRow, ensureCustomer, proLineItems } from '@/lib/billing';
import { effectivePlan, type Interval } from '@/lib/plans';
import { hasStripe, stripe } from '@/lib/stripe';
import { publicOrigin } from '@/lib/origin';

// Start Stripe Checkout for Pro.
// POST {workspace_id, interval}       upgrade this brand (owners)
// POST {new_brand_name, interval}     a further brand: created by the webhook once paid
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!hasStripe()) return Response.json({ error: 'Billing isn’t switched on yet.' }, { status: 501 });
  const b = await request.json().catch(() => null);
  const interval: Interval = b?.interval === 'year' ? 'year' : 'month';
  const newBrand = typeof b?.new_brand_name === 'string' ? b.new_brand_name.trim().slice(0, 60) : '';
  const who = await whoFor(newBrand ? '' : String(b?.workspace_id || ''));
  if (!who.user) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const email = who.user.email || '';
  const origin = publicOrigin(request);
  const db = createAdminClient();
  const tax = process.env.STRIPE_TAX === '1';

  const common = {
    mode: 'subscription',
    line_items: proLineItems(interval),
    allow_promotion_codes: 'true',
    billing_address_collection: 'required',
    tax_id_collection: { enabled: 'true' },
    customer_update: { address: 'auto', name: 'auto' },
    ...(tax ? { automatic_tax: { enabled: 'true' } } : {}),
    locale: 'en-GB',
  };

  try {
    if (newBrand) {
      // A fresh customer for the new brand, so its invoices and extra designs stay separate.
      const c = await stripe('POST', '/customers', { name: newBrand, email, metadata: { pending_brand: newBrand, user_id: who.user.id }, preferred_locales: ['en-GB'] });
      const s = await stripe('POST', '/checkout/sessions', {
        ...common,
        customer: c.id,
        client_reference_id: who.user.id,
        metadata: { kind: 'new_brand', brand_name: newBrand, user_id: who.user.id },
        subscription_data: { metadata: { kind: 'new_brand', user_id: who.user.id } },
        success_url: `${origin}/?billing=new-brand`,
        cancel_url: `${origin}/?billing=cancelled`,
      });
      return Response.json({ url: s.url });
    }

    if (!who.ws) return Response.json({ error: 'Workspace not found.' }, { status: 404 });
    if (who.role !== 'owner') return Response.json({ error: 'Only owners can upgrade a brand.' }, { status: 403 });
    const row = await billingRow(db, who.ws.id);
    if (effectivePlan(row) !== 'free') return Response.json({ error: `${who.ws.name} is already on Pro.` }, { status: 409 });
    const customer = await ensureCustomer(db, who.ws, email);
    const s = await stripe('POST', '/checkout/sessions', {
      ...common,
      customer,
      client_reference_id: who.user.id,
      metadata: { kind: 'upgrade', workspace_id: who.ws.id, user_id: who.user.id },
      subscription_data: { metadata: { workspace_id: who.ws.id } },
      success_url: `${origin}/?billing=upgraded&ws=${who.ws.id}`,
      cancel_url: `${origin}/?billing=cancelled&ws=${who.ws.id}`,
    });
    return Response.json({ url: s.url });
  } catch (e: any) {
    console.error('[billing] checkout', e?.message);
    return Response.json({ error: 'Couldn’t open checkout. Try again in a moment.' }, { status: 502 });
  }
}
