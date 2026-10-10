// LEGACY: these are the original prices (before 9 Oct 2026). Current Pro is $3,750 a year: see scripts/stripe-annual.mjs.
// Sets up Stripe for Mise Pro, once per Stripe account (test mode first, then live).
//   STRIPE_SECRET_KEY=sk_test_… node scripts/stripe-setup.mjs
// Creates (or finds, if run again): the "studio_design" meter, the Pro product with its
// £149/$199 a month and £1,490/$1,990 a year prices, the extra-designs product with 50p/60¢ metered prices,
// and a customer portal configuration. Prints the env lines to paste into Railway.
const KEY = process.env.STRIPE_SECRET_KEY;
if (!KEY) { console.error('Set STRIPE_SECRET_KEY first.'); process.exit(1); }

function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === 'object' ? form(x, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(x))));
    else if (typeof v === 'object') form(v, key, out);
    else out.append(key, String(v));
  }
  return out;
}
async function api(method, path, body) {
  const qs = method === 'GET' && body ? `?${form(body)}` : '';
  const r = await fetch(`https://api.stripe.com/v1${path}${qs}`, { method, headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/x-www-form-urlencoded' }, body: method === 'POST' && body ? form(body).toString() : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path}: ${j?.error?.message}`);
  return j;
}

const EVENT = 'studio_design';
const meters = await api('GET', '/billing/meters', { limit: 100 });
let meter = meters.data.find((m) => m.event_name === EVENT && m.status === 'active');
meter ??= await api('POST', '/billing/meters', {
  display_name: 'Studio designs (extra)', event_name: EVENT,
  default_aggregation: { formula: 'sum' },
  customer_mapping: { type: 'by_id', event_payload_key: 'stripe_customer_id' },
  value_settings: { event_payload_key: 'value' },
});

async function price(lookup, make) {
  const found = await api('GET', '/prices', { lookup_keys: [lookup], active: 'true' });
  return found.data[0] || make();
}
async function product(id, body) {
  try { return await api('GET', `/products/${id}`); } catch { return api('POST', '/products', { id, ...body }); }
}

// txcd_10103001: SaaS, business use (for Stripe Tax)
const pro = await product('mise_pro', { name: 'Mise Pro', description: 'Per brand: unlimited files and storage, 200 Studio designs a month, unlimited portals, licence expiry and asset lifecycle.', tax_code: 'txcd_10103001' });
const extra = await product('mise_extra_designs', { name: 'Mise Studio designs (extra)', description: '50p per Studio design over the monthly allowance, up to the cap you set.', tax_code: 'txcd_10103001' });

const proMonth = await price('mise_pro_month', () => api('POST', '/prices', { product: pro.id, currency: 'gbp', unit_amount: 14900, tax_behavior: 'exclusive', currency_options: { usd: { unit_amount: 19900, tax_behavior: 'exclusive' } }, lookup_key: 'mise_pro_month', nickname: 'Pro monthly', recurring: { interval: 'month' } }));
const proYear = await price('mise_pro_year', () => api('POST', '/prices', { product: pro.id, currency: 'gbp', unit_amount: 149000, tax_behavior: 'exclusive', currency_options: { usd: { unit_amount: 199000, tax_behavior: 'exclusive' } }, lookup_key: 'mise_pro_year', nickname: 'Pro yearly', recurring: { interval: 'year' } }));
const exMonth = await price('mise_extra_month', () => api('POST', '/prices', { product: extra.id, currency: 'gbp', unit_amount: 50, tax_behavior: 'exclusive', currency_options: { usd: { unit_amount: 60, tax_behavior: 'exclusive' } }, lookup_key: 'mise_extra_month', nickname: 'Extra designs (monthly plans)', recurring: { interval: 'month', usage_type: 'metered', meter: meter.id } }));
const exYear = await price('mise_extra_year', () => api('POST', '/prices', { product: extra.id, currency: 'gbp', unit_amount: 50, tax_behavior: 'exclusive', currency_options: { usd: { unit_amount: 60, tax_behavior: 'exclusive' } }, lookup_key: 'mise_extra_year', nickname: 'Extra designs (yearly plans)', recurring: { interval: 'year', usage_type: 'metered', meter: meter.id } }));

// Customer portal: invoices, card, billing details and VAT number, cancel at period end.
// Switching monthly/yearly is left off for now (the metered item has to switch with it).
const configs = await api('GET', '/billing_portal/configurations', { limit: 50, active: 'true' });
let portal = configs.data.find((c) => c.metadata?.app === 'mise');
if (!portal) {
  portal = await api('POST', '/billing_portal/configurations', {
    metadata: { app: 'mise' },
    business_profile: { headline: 'Mise: manage your brand’s plan' },
    features: {
      invoice_history: { enabled: 'true' },
      payment_method_update: { enabled: 'true' },
      customer_update: { enabled: 'true', allowed_updates: ['name', 'email', 'address', 'tax_id'] },
      subscription_cancel: { enabled: 'true', mode: 'at_period_end', cancellation_reason: { enabled: 'true', options: ['too_expensive', 'missing_features', 'switched_service', 'unused', 'other'] } },
    },
  });
}

console.log(`\nStripe is set up (${KEY.startsWith('sk_live') ? 'LIVE' : 'test'} mode). Add these to Railway:\n`);
console.log(`STRIPE_PRICE_PRO_MONTH=${proMonth.id}`);
console.log(`STRIPE_PRICE_PRO_YEAR=${proYear.id}`);
console.log(`STRIPE_PRICE_OVERAGE_MONTH=${exMonth.id}`);
console.log(`STRIPE_PRICE_OVERAGE_YEAR=${exYear.id}`);
console.log(`STRIPE_METER_EVENT=${EVENT}`);
console.log(`STRIPE_PORTAL_CONFIG=${portal.id}`);
console.log(`\nThen add a webhook endpoint https://<your app>/api/billing/webhook with events:`);
console.log('  checkout.session.completed, customer.subscription.created, customer.subscription.updated,');
console.log('  customer.subscription.deleted, invoice.payment_failed');
console.log('and set STRIPE_WEBHOOK_SECRET to its signing secret (whsec_…).');
