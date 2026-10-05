// Billing for one brand (workspace), server only. Pro is per brand: each brand that's on Pro
// has its own Stripe customer and subscription, so its invoices, VAT details and extra
// designs stay separate. Free brands never touch Stripe.
import { createAdminClient } from './supabase/admin';
import { effectivePlan, type Billing, type Interval, type Plan } from './plans';
import { overagePriceFor, priceFor, stripe } from './stripe';

type Db = ReturnType<typeof createAdminClient>;

export async function billingRow(db: Db, ws: string) {
  const { data } = await db.from('workspace_billing').select('*').eq('workspace_id', ws).maybeSingle();
  return data as Record<string, any> | null;
}

export async function planOf(db: Db, ws: string): Promise<{ plan: Plan; row: Record<string, any> | null }> {
  const row = await billingRow(db, ws);
  return { plan: effectivePlan(row), row };
}

export function toBilling(row: Record<string, any> | null): Billing {
  return {
    plan: effectivePlan(row),
    interval: (row?.interval as Interval) || null,
    status: row?.subscription_status || null,
    current_period_end: row?.current_period_end || null,
    cancel_at_period_end: !!row?.cancel_at_period_end,
    overage_cap_pence: row?.overage_cap_pence ?? 5000,
    has_customer: !!row?.stripe_customer_id,
  };
}

// The brand's Stripe customer, created the first time it goes to checkout.
export async function ensureCustomer(db: Db, ws: { id: string; name: string }, email: string) {
  const row = await billingRow(db, ws.id);
  if (row?.stripe_customer_id) return row.stripe_customer_id as string;
  const c = await stripe('POST', '/customers', {
    name: ws.name, email,
    metadata: { workspace_id: ws.id },
    preferred_locales: ['en-GB'],
  }, `customer-${ws.id}`);
  await db.from('workspace_billing').upsert({ workspace_id: ws.id, stripe_customer_id: c.id, updated_at: new Date().toISOString() }, { onConflict: 'workspace_id' });
  return c.id as string;
}

// Line items for Pro: the flat price, plus the metered price for extra designs when it's set up.
export function proLineItems(interval: Interval) {
  const items: Record<string, any>[] = [{ price: priceFor(interval), quantity: 1 }];
  const metered = overagePriceFor(interval);
  if (metered) items.push({ price: metered });
  return items;
}

// Write a Stripe subscription onto its brand. Called from the webhook for every change.
export async function syncSubscription(db: Db, sub: any, wsHint?: string) {
  const ws = wsHint || sub?.metadata?.workspace_id;
  if (!ws) { console.error('[billing] subscription without workspace_id', sub?.id); return; }
  const flat = (sub.items?.data || []).find((i: any) => i.price?.recurring?.usage_type !== 'metered') || sub.items?.data?.[0];
  const interval: Interval = flat?.price?.recurring?.interval === 'year' ? 'year' : 'month';
  const periodEnd = flat?.current_period_end || sub.current_period_end;
  const ended = ['canceled', 'incomplete_expired', 'unpaid'].includes(sub.status);
  await db.from('workspace_billing').upsert({
    workspace_id: ws,
    plan: ended ? 'free' : 'pro',
    interval: ended ? null : interval,
    stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
    stripe_subscription_id: ended ? null : sub.id,
    subscription_status: sub.status,
    current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
    cancel_at_period_end: !!sub.cancel_at_period_end,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'workspace_id' });
  // Upgraded: anything waiting under Free's organising pace goes back in the queue now.
  if (!ended && ['active', 'trialing'].includes(sub.status)) {
    const { error } = await db.rpc('resume_paused_tags', { ws, force: true });
    if (error) console.error('[billing] resume organising', error.message);
  }
}

// A new brand bought through checkout (the person already owns a free brand): make it, as Pro.
export async function createPaidBrand(db: Db, userId: string, name: string, customer: string) {
  // Webhooks can arrive twice: if this customer already has its brand, that's the one.
  const { data: seen } = await db.from('workspace_billing').select('workspace_id').eq('stripe_customer_id', customer).maybeSingle();
  if (seen) return seen.workspace_id as string;
  const { data: w, error } = await db.from('workspaces').insert({ name: name.trim().slice(0, 60) || 'New brand', created_by: userId }).select('id, name').single();
  if (error || !w) throw new Error(error?.message || 'Couldn’t create the brand');
  const { error: e2 } = await db.from('workspace_billing').insert({ workspace_id: w.id, stripe_customer_id: customer, plan: 'pro', subscription_status: 'active' });
  if (e2) {
    // Another delivery got there first (stripe_customer_id is unique): drop this copy.
    await db.from('workspaces').delete().eq('id', w.id);
    const { data: other } = await db.from('workspace_billing').select('workspace_id').eq('stripe_customer_id', customer).maybeSingle();
    if (other) return other.workspace_id as string;
    throw new Error(e2.message);
  }
  await db.from('workspace_members').insert({ workspace_id: w.id, user_id: userId, role: 'owner' });
  await stripe('POST', `/customers/${customer}`, { name: w.name, metadata: { workspace_id: w.id } }).catch(() => {});
  return w.id as string;
}

// Deleting a brand on Pro: stop its subscription straight away so it isn't billed again.
export async function cancelNow(db: Db, ws: string) {
  const row = await billingRow(db, ws);
  if (!row?.stripe_subscription_id) return;
  await stripe('DELETE', `/subscriptions/${row.stripe_subscription_id}`, { invoice_now: 'true', prorate: 'false' });
}
