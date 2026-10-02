// Monthly AI allowances per workspace, so one big import can't run up a surprise bill.
// Defaults below (override with AI_CAP_TAG etc., or per workspace in workspaces.ai_caps).
// Crossing 80% and 100% sends one alert each month to ALERT_EMAIL (needs RESEND_API_KEY).
import { createAdminClient } from './supabase/admin';
import { notify } from './notify';

export type UsageKind = 'tag' | 'search' | 'design' | 'kit';

const DEFAULTS: Record<UsageKind, number> = { tag: 3000, search: 2000, design: 300, kit: 20 };
export const LABEL: Record<UsageKind, string> = { tag: 'files organised', search: 'plain-English searches', design: 'Studio designs', kit: 'brand kits from a website' };

export function capFor(kind: UsageKind) {
  const v = Number(process.env[`AI_CAP_${kind.toUpperCase()}`]);
  return Number.isFinite(v) && v >= 0 ? Math.floor(v) : DEFAULTS[kind];
}

export type Take = { ok: boolean; used: number; cap: number };

// Take n from the workspace's allowance. Fails open (allows) if the check itself errors,
// so a database hiccup never breaks the product; the error is logged.
export async function takeUsage(ws: string, kind: UsageKind, n = 1): Promise<Take> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { ok: true, used: 0, cap: capFor(kind) };
  try {
    const db = createAdminClient();
    const { data, error } = await db.rpc('ai_usage_take', { p_ws: ws, p_kind: kind, p_n: n, p_cap: capFor(kind) });
    if (error) { console.error('[usage]', error.message); return { ok: true, used: 0, cap: capFor(kind) }; }
    const row = (Array.isArray(data) ? data[0] : data) as { ok: boolean; used: number; cap: number; alert: number } | null;
    if (!row) return { ok: true, used: 0, cap: capFor(kind) };
    if (row.alert) {
      const { data: w } = await db.from('workspaces').select('name').eq('id', ws).maybeSingle();
      const name = w?.name || ws;
      void notify(
        row.alert >= 100 ? `Mise: ${name} hit its monthly limit for ${LABEL[kind]}` : `Mise: ${name} is at 80% of its monthly ${LABEL[kind]}`,
        `${name} (${ws}) has used ${row.used} of ${row.cap} ${LABEL[kind]} this month.\n\n` +
        (row.alert >= 100 ? 'New requests of this kind are paused until the 1st. ' : '') +
        `To raise it for this workspace, set workspaces.ai_caps to {"${kind}": <new limit>} in Supabase.`,
      );
    }
    return { ok: row.ok, used: row.used, cap: row.cap };
  } catch (e: any) {
    console.error('[usage]', e?.message);
    return { ok: true, used: 0, cap: capFor(kind) };
  }
}

export function limitMessage(kind: UsageKind) {
  return `This brand has used its ${LABEL[kind]} for this month. It resets on the 1st, or tell us through Feedback and we’ll raise it.`;
}
