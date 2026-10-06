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

export const PRICE = {
  month: 14900,        // £149 a month per brand, in pence, excluding VAT
  year: 149000,        // £1,490 a year per brand (2 months free)
  overage: 50,         // 50p per Studio design over the allowance
};

// Free trial on Pro, card up front. One per brand: a brand that has had a subscription before doesn't get another.
export const TRIAL_DAYS = 7;
export const trialDaysFor = (row: { subscription_status?: string | null } | null | undefined) => (row?.subscription_status ? 0 : TRIAL_DAYS);

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
export function overageDesigns(plan: Plan, capPence: number) {
  if (!PLANS[plan]?.overage) return 0;
  return Math.max(0, Math.floor(capPence / PRICE.overage));
}

export type Billing = {
  plan: Plan;
  interval: Interval | null;
  status: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  overage_cap_pence: number;
  has_customer: boolean;
};

// The plan a billing row actually gives (a lapsed subscription is Free).
export function effectivePlan(row: { plan?: string | null; subscription_status?: string | null } | null | undefined): Plan {
  if (!row || !row.plan || row.plan === 'free') return 'free';
  const s = row.subscription_status || 'active';
  return ['active', 'trialing', 'past_due'].includes(s) ? (row.plan as Plan) : 'free';
}
