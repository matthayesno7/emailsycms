// Pro becomes yearly only at $3,750 per brand (9 Oct 2026). Creates the new yearly USD price on the
// existing Mise Pro product and prints its ID for Railway. Old prices stay active for existing
// subscribers. Safe to run again (it reuses the price if it already exists).
//   read -s STRIPE_SECRET_KEY && export STRIPE_SECRET_KEY && node scripts/stripe-annual.mjs
const KEY = process.env.STRIPE_SECRET_KEY;
if (!KEY) { console.error('Set STRIPE_SECRET_KEY first.'); process.exit(1); }
async function api(method, path, body) {
  const r = await fetch(`https://api.stripe.com/v1${path}`, { method, headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/x-www-form-urlencoded' }, body: body ? new URLSearchParams(body).toString() : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path}: ${j?.error?.message}`);
  return j;
}
const LOOKUP = 'mise_pro_year_3750';
const old = (await api('GET', '/prices?active=true&lookup_keys[0]=mise_pro_year')).data[0];
if (!old) { console.error('✗ No mise_pro_year price found. Run scripts/stripe-setup.mjs first.'); process.exit(1); }
let price = (await api('GET', `/prices?active=true&lookup_keys[0]=${LOOKUP}`)).data[0];
if (price) console.log(`✓ ${LOOKUP} already exists`);
else {
  price = await api('POST', '/prices', {
    product: old.product, currency: 'usd', unit_amount: '375000', tax_behavior: 'exclusive',
    'recurring[interval]': 'year', lookup_key: LOOKUP, nickname: 'Pro yearly ($3,750)',
  });
  console.log(`✓ Created ${LOOKUP}: $3,750 a year`);
}
console.log(`\nOn Railway, set:\n  STRIPE_PRICE_PRO_YEAR=${price.id}\nthen redeploy. Leave STRIPE_PRICE_PRO_MONTH and the overage prices as they are (existing subscribers use them).`);
console.log('\nIn Stripe → Settings → Billing → Customer portal → Subscriptions: if "switch plans" is on, replace the old Pro prices with this one, so customers can\'t switch back to the old prices.');
