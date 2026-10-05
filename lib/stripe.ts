// Stripe, server only: a small client over the REST API (no SDK) and the meter event for extra
// Studio designs. Webhook signature checks are in stripeWebhook.ts (it needs node:crypto, and this
// file is pulled into the background worker, which Next also bundles for the edge runtime).
//
// Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_PRO_MONTH, STRIPE_PRICE_PRO_YEAR,
// STRIPE_PRICE_OVERAGE_MONTH, STRIPE_PRICE_OVERAGE_YEAR (optional: no overage billed without them),
// STRIPE_METER_EVENT (default studio_design). scripts/stripe-setup.mjs creates them all.
import type { Interval } from './plans';

const API = 'https://api.stripe.com/v1';

export const hasStripe = () => !!process.env.STRIPE_SECRET_KEY && !!process.env.STRIPE_PRICE_PRO_MONTH;
export const meterEvent = () => process.env.STRIPE_METER_EVENT || 'studio_design';

export function priceFor(interval: Interval) {
  return interval === 'year' ? process.env.STRIPE_PRICE_PRO_YEAR || '' : process.env.STRIPE_PRICE_PRO_MONTH || '';
}
export function overagePriceFor(interval: Interval) {
  return interval === 'year' ? process.env.STRIPE_PRICE_OVERAGE_YEAR || '' : process.env.STRIPE_PRICE_OVERAGE_MONTH || '';
}

// Stripe wants form encoding with bracketed keys: line_items[0][price]=…
function form(obj: Record<string, any>, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((item, i) => (typeof item === 'object' ? form(item, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(item))));
    else if (typeof v === 'object') form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}

export async function stripe<T = any>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: Record<string, any>, idempotencyKey?: string): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Stripe isn’t set up (STRIPE_SECRET_KEY).');
  const qs = method === 'GET' && body ? `?${form(body)}` : '';
  const r = await fetch(`${API}${path}${qs}`, {
    method,
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/x-www-form-urlencoded',
      ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
    },
    body: method !== 'GET' && body ? form(body).toString() : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `Stripe ${r.status}`);
  return j as T;
}

// One extra Studio design for a brand's Stripe customer (billed at 50p on the next invoice).
// The identifier makes retries safe: Stripe counts each identifier once.
export async function reportOverage(customer: string, identifier: string, value = 1) {
  return stripe('POST', '/billing/meter_events', {
    event_name: meterEvent(),
    identifier,
    timestamp: Math.floor(Date.now() / 1000),
    payload: { stripe_customer_id: customer, value },
  });
}
