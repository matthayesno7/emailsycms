// Mise plans. Files, storage and organising are unlimited on every plan; the only thing
// we meter is Studio designs, because they are the only thing that costs us real money.
// Shared by server and browser: no secrets here.

export type Plan = 'free' | 'pro' | 'enterprise';
export type Interval = 'month' | 'year';

export const PLANS = {
  // Free is a taster: brand kit, up to 50 files, one Studio run (a brief and its designs).
  // More files, more Studio, sharing and editing are on Pro. designs and organise on Free are
  // only safety ceilings (12 design calls cover one run with extra sizes).
  free: { name: 'Free', files: 50, designs: 12, organise: 200, overage: false, portals: 0, badge: true, lifecycle: false },
  pro: { name: 'Pro', files: Infinity, designs: 200, organise: 20000, overage: true, portals: Infinity, badge: false, lifecycle: true },
  enterprise: { name: 'Enterprise', files: Infinity, designs: 1000, organise: 50000, overage: true, portals: Infinity, badge: false, lifecycle: true },
} as const;

// Currencies: USD for everyone (GBP only for brands that subscribed before 9 Oct 2026). Amounts in minor units (pence, cents),
// excluding VAT or sales tax. The same Stripe prices carry both (currency_options).
export type Currency = 'gbp' | 'usd';
// Pro is yearly only (9 Oct 2026): $3,750 a year per brand, in US dollars for everyone. The monthly
// amounts and GBP stay only so brands that subscribed before then still show what they pay.
export const ANNUAL_ONLY = true;
export const PRICES: Record<Currency, { month: number; year: number; overage: number }> = {
  gbp: { month: 14900, year: 149000, overage: 50 },   // legacy: £149 a month or £1,490 a year; 50p per extra design
  usd: { month: 19900, year: 375000, overage: 60 },   // $3,750 a year per brand (legacy $199 a month); 60¢ per extra design
};
export const ENTERPRISE_FROM_USD = 15000;            // Enterprise starts at $15,000 a year
export const PRICE = PRICES.gbp; // existing GBP brands
export const isCurrency = (c: unknown): c is Currency => c === 'gbp' || c === 'usd';
// Visitors in the UK see and pay GBP; everyone else USD. Cloudflare's country header decides; without
// it, a British English browser counts as the UK.
// Since 9 Oct 2026 every new subscription is in US dollars, the UK included. (The arguments stay so
// callers don't change; GBP brands keep their currency through their billing row.)
export const currencyFor = (_country?: string | null, _lang?: string | null): Currency => 'usd';
export const currencyOf = (h: Headers) => currencyFor(h.get('cf-ipcountry'), h.get('accept-language'));
export const money = (minor: number, cur: Currency = 'gbp') =>
  `${cur === 'usd' ? '$' : '£'}${(minor / 100).toLocaleString(cur === 'usd' ? 'en-US' : 'en-GB', { minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
export const symbol = (cur: Currency = 'gbp') => (cur === 'usd' ? '$' : '£');

// No trial: Free is how people try Mise, and Pro is charged from day one. (Set above 0 to bring a
// card-up-front trial back; it's offered once per brand.)
export const TRIAL_DAYS = 0;
export const trialDaysFor = (row: { subscription_status?: string | null } | null | undefined) => (row?.subscription_status || !TRIAL_DAYS ? 0 : TRIAL_DAYS);

export const gbp = (pence: number) => `£${(pence / 100).toLocaleString('en-GB', { minimumFractionDigits: pence % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

// Safety ceilings for the "unlimited" things, per brand per month. Generous enough that
// a real brand library never meets them; they only stop runaway imports or abuse.
// Override with AI_CAP_TAG etc., or per brand in workspaces.ai_caps.
export const FAIR_USE = { tag: 20000, search: 10000, kit: 30 } as const;

// Largest single file, on every plan (like Canva: big enough for any brand library, too small for raw footage or backups).
// Imports from Drive, Dropbox, Box and Claude go through the server, so they stop at 100 MB.
export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;
export const MAX_IMPORT_BYTES = 100 * 1024 * 1024;
export const mb = (bytes: number) => (bytes >= 1024 ** 3 ? `${Math.round(bytes / 1024 ** 3)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`);

// Why a file is too big, or null when it's fine.
export function tooBig(f: { size: number; type?: string; name?: string }) {
  const video = /^video\//.test(f.type || '') || /\.(mp4|webm|mov)$/i.test(f.name || '');
  const max = video ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  return f.size > max ? `${f.name || 'That file'} is ${mb(f.size)}. ${video ? 'Videos' : 'Images'} can be up to ${mb(max)}.` : null;
}

// A Studio "run" is one brief. The key is the same for the same words, so retries, extra sizes
// and the page re-rendering never count as a second run.
export function runKey(brief: string) {
  const t = brief.toLowerCase().replace(/\s+/g, ' ').trim();
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0;
  return `r${h.toString(36)}`;
}

export const FREE_FILES = 50;
// Files that count towards Free's 50: anything with a stored file, except email blocks.
export const countsAsFile = (a: { storage_path?: string | null; kind?: string }) => !!a.storage_path && a.kind !== 'block';
// Errors the database raises at Free's limits (see the free_taster migration).
export const freeLimitOf = (msg?: string | null): 'files' | 'edit' | null => (/FREE_FILE_LIMIT/.test(msg || '') ? 'files' : /PRO_EDIT/.test(msg || '') ? 'edit' : null);

export function organisePace(plan: Plan) {
  return PLANS[plan]?.organise ?? PLANS.free.organise;
}

export function designAllowance(plan: Plan) {
  return PLANS[plan]?.designs ?? PLANS.free.designs;
}

// How many paid extra designs fit under a monthly overage cap.
export function overageDesigns(plan: Plan, capPence: number, cur: Currency = 'gbp') {
  if (!PLANS[plan]?.overage) return 0;
  return Math.max(0, Math.floor(capPence / PRICES[cur].overage));
}

export type Billing = {
  plan: Plan;
  interval: Interval | null;
  status: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  overage_cap_pence: number;
  has_customer: boolean;
  currency: Currency | null; // set once the brand has paid; until then it follows the visitor's country
};

// The plan a billing row actually gives (a lapsed subscription is Free).
export function effectivePlan(row: { plan?: string | null; subscription_status?: string | null } | null | undefined): Plan {
  if (!row || !row.plan || row.plan === 'free') return 'free';
  const s = row.subscription_status || 'active';
  return ['active', 'trialing', 'past_due'].includes(s) ? (row.plan as Plan) : 'free';
}
