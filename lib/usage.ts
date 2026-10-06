// Monthly AI usage per brand (workspace).
// Studio designs are the one thing plans meter: Free 20 a month, Pro 200, then 50p each on Pro
// up to the brand's own monthly cap (reported to Stripe as a meter event).
// Organising, search and brand kits are unlimited on every plan; their caps are only
// fair-use ceilings against runaway imports (override with AI_CAP_TAG etc., or per brand in
// workspaces.ai_caps). Crossing 80% and 100% of a cap sends one alert a month to ALERT_EMAIL.
import { createAdminClient } from './supabase/admin';
import { notify } from './notify';
import { planOf } from './billing';
import { designAllowance, FAIR_USE, organisePace, overageDesigns, PLANS, type Plan } from './plans';
import { overagePriceFor, reportOverage } from './stripe';

export type UsageKind = 'tag' | 'search' | 'design' | 'kit';

export const LABEL: Record<UsageKind, string> = { tag: 'files organised', search: 'plain-English searches', design: 'Studio designs', kit: 'brand kits from a website' };

export function capFor(kind: UsageKind, plan: Plan = 'free') {
  if (kind === 'design') return designAllowance(plan);
  if (kind === 'tag' && plan === 'free') return organisePace('free');
  const v = Number(process.env[`AI_CAP_${kind.toUpperCase()}`]);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : FAIR_USE[kind];
}

export type Take = { ok: boolean; used: number; cap: number; plan: Plan; extra?: boolean; reason?: 'allowance' | 'overage_cap' | 'fair_use' };

async function take(db: ReturnType<typeof createAdminClient>, ws: string, kind: UsageKind, n: number, cap: number) {
  const { data, error } = await db.rpc('ai_usage_take', { p_ws: ws, p_kind: kind, p_n: n, p_cap: cap });
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) as { ok: boolean; used: number; cap: number; alert: number } | null;
}

// Take n from the brand's allowance. Fails open (allows) if the check itself errors,
// so a database hiccup never breaks the product; the error is logged.
export async function takeUsage(ws: string, kind: UsageKind, n = 1): Promise<Take> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: true, used: 0, cap: capFor(kind), plan: 'free' };
  let plan: Plan = 'free';
  try {
    const db = createAdminClient();
    const p = await planOf(db, ws);
    plan = p.plan;
    const base = capFor(kind, plan);
    let row = await take(db, ws, kind, n, base);
    if (!row) return { ok: true, used: 0, cap: base, plan };

    // Pro: past the allowance, extra designs at 50p each, up to the brand's monthly cap.
    let extra = false;
    const customer = p.row?.stripe_customer_id as string | undefined;
    const interval = (p.row?.interval as 'month' | 'year') || 'month';
    if (!row.ok && kind === 'design' && PLANS[plan].overage && customer && overagePriceFor(interval)) {
      const room = overageDesigns(plan, p.row?.overage_cap_pence ?? 5000, p.row?.currency === 'usd' ? 'usd' : 'gbp');
      if (room > 0) {
        const r2 = await take(db, ws, kind, n, base + room);
        if (r2?.ok) {
          row = r2; extra = true;
          const month = new Date().toISOString().slice(0, 7);
          // One meter event per extra design; the identifier stops double counting on retries.
          for (let i = 0; i < n; i++) {
            const id = `${ws}:${month}:design:${r2.used - i}`;
            reportOverage(customer, id).catch((e) => console.error('[usage] meter event', id, e?.message));
          }
        } else if (r2) row = r2;
      }
    }

    // Free brands reaching their organising pace is expected, not news: no alert for that.
    if (row.alert && !extra && !(kind === 'tag' && plan === 'free')) {
      const { data: w } = await db.from('workspaces').select('name').eq('id', ws).maybeSingle();
      const name = w?.name || ws;
      void notify(
        row.alert >= 100 ? `Mise: ${name} hit its monthly limit for ${LABEL[kind]}` : `Mise: ${name} is at 80% of its monthly ${LABEL[kind]}`,
        `${name} (${ws}, ${PLANS[plan].name}) has used ${row.used} of ${row.cap} ${LABEL[kind]} this month.\n\n` +
        (row.alert >= 100 ? 'New requests of this kind are paused until the 1st. ' : '') +
        (kind === 'design' ? 'Studio designs are set by the plan.' : `To raise it for this brand, set workspaces.ai_caps to {"${kind}": <new limit>} in Supabase.`),
      );
    }
    const reason: Take['reason'] = row.ok ? undefined : kind !== 'design' ? 'fair_use' : PLANS[plan].overage ? 'overage_cap' : 'allowance';
    return { ok: row.ok, used: row.used, cap: row.cap, plan, extra, reason };
  } catch (e: any) {
    console.error('[usage]', e?.message);
    return { ok: true, used: 0, cap: capFor(kind, plan), plan };
  }
}

export function limitMessage(kind: UsageKind, t?: Pick<Take, 'plan' | 'reason'>) {
  if (kind === 'design' && t?.reason === 'allowance') {
    return `This brand has used its ${designAllowance(t.plan)} Studio designs for this month on Free. Upgrade it to Pro for ${designAllowance('pro')} a month (then 50p a design), or they reset on the 1st.`;
  }
  if (kind === 'design' && t?.reason === 'overage_cap') {
    return 'This brand has reached the monthly spending cap for extra Studio designs. An owner can raise it in Settings → Plan, or it resets on the 1st.';
  }
  return `This brand has used its ${LABEL[kind]} for this month. It resets on the 1st, or tell us through Feedback and we’ll raise it.`;
}
