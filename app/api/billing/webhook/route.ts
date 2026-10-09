import { createAdminClient } from '@/lib/supabase/admin';
import { createPaidBrand, syncSubscription } from '@/lib/billing';
import { stripe } from '@/lib/stripe';
import { verifyWebhook } from '@/lib/stripeWebhook';
import { notify } from '@/lib/notify';
import { onProConfirmed } from '@/lib/emails/send';

// Stripe → Mise. Point a webhook endpoint at /api/billing/webhook with these events:
// checkout.session.completed, customer.subscription.created, customer.subscription.updated,
// customer.subscription.deleted, invoice.payment_failed.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const payload = await request.text();
  const event = verifyWebhook(payload, request.headers.get('stripe-signature'));
  if (!event) return new Response('Bad signature', { status: 400 });
  const db = createAdminClient();
  const obj = event.data?.object || {};

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        if (obj.mode !== 'subscription' || !obj.subscription) break;
        const sub = await stripe('GET', `/subscriptions/${obj.subscription}`);
        let ws = obj.metadata?.workspace_id as string | undefined;
        if (obj.metadata?.kind === 'new_brand') {
          ws = await createPaidBrand(db, obj.metadata.user_id, obj.metadata.brand_name || 'New brand', obj.customer);
          await stripe('POST', `/subscriptions/${sub.id}`, { metadata: { workspace_id: ws } }).catch(() => {});
          await syncSubscription(db, sub, ws);
        } else {
          await syncSubscription(db, sub, ws);
        }
        // Welcome to Pro: once per brand, to the person who paid. Never holds up the webhook.
        if (ws && ['active', 'trialing'].includes(sub.status)) void onProConfirmed(db, ws, { userId: obj.client_reference_id || obj.metadata?.user_id, email: obj.customer_details?.email });
        void notify(`Mise: new Pro brand`, `${obj.customer_details?.email || 'Someone'} is now on Pro (${obj.metadata?.brand_name || obj.metadata?.workspace_id || ''}).`);
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        // Find the brand: from the subscription's metadata, or by its customer.
        let ws = obj.metadata?.workspace_id as string | undefined;
        if (!ws) {
          const { data } = await db.from('workspace_billing').select('workspace_id').eq('stripe_customer_id', obj.customer).maybeSingle();
          ws = data?.workspace_id;
        }
        if (!ws) break; // a new brand not created yet: checkout.session.completed does it
        await syncSubscription(db, obj, ws);
        // In case Checkout's own event is late or missed. Sent once per brand either way.
        if (event.type !== 'customer.subscription.deleted' && ['active', 'trialing'].includes(obj.status)) void onProConfirmed(db, ws, {});
        break;
      }
      case 'invoice.payment_failed': {
        const { data } = await db.from('workspace_billing').select('workspace_id').eq('stripe_customer_id', obj.customer).maybeSingle();
        void notify('Mise: a payment failed', `Brand ${data?.workspace_id || '?'} (${obj.customer_email || obj.customer}): invoice ${obj.id} failed. Stripe will retry; the brand stays on Pro while it's past due.`);
        break;
      }
    }
  } catch (e: any) {
    console.error('[billing] webhook', event.type, e?.message);
    return new Response('Error', { status: 500 }); // Stripe retries
  }
  return Response.json({ received: true });
}
