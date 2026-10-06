// Adds US dollar amounts to Mise's existing Stripe prices, so Checkout can charge USD outside the UK.
//   read -s STRIPE_SECRET_KEY && export STRIPE_SECRET_KEY && node scripts/stripe-usd.mjs
// Pro $199/month and $1,990/year; extra designs 60¢. Safe to run again (it skips prices that have USD).
const KEY = process.env.STRIPE_SECRET_KEY;
if (!KEY) { console.error('Set STRIPE_SECRET_KEY first.'); process.exit(1); }
async function api(method, path, body) {
  const r = await fetch(`https://api.stripe.com/v1${path}`, { method, headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/x-www-form-urlencoded' }, body: body ? new URLSearchParams(body).toString() : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path}: ${j?.error?.message}`);
  return j;
}
const USD = { mise_pro_month: 19900, mise_pro_year: 199000, mise_extra_month: 60, mise_extra_year: 60 };
for (const [lookup, cents] of Object.entries(USD)) {
  const found = await api('GET', `/prices?active=true&lookup_keys[0]=${lookup}&expand[0]=data.currency_options`);
  const p = found.data[0];
  if (!p) { console.log(`✗ ${lookup}: no such price (run stripe-setup.mjs first)`); continue; }
  if (p.currency_options?.usd) { console.log(`✓ ${lookup}: already has USD`); continue; }
  await api('POST', `/prices/${p.id}`, { 'currency_options[usd][unit_amount]': String(cents), 'currency_options[usd][tax_behavior]': 'exclusive' });
  console.log(`✓ ${lookup}: added $${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`);
}
console.log('\nDone. No Railway changes needed: the same price IDs now carry GBP and USD.');
