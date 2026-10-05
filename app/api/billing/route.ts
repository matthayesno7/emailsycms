import { createAdminClient } from '@/lib/supabase/admin';
import { whoFor } from '@/lib/billingAuth';
import { billingRow, cancelNow, toBilling } from '@/lib/billing';
import { designAllowance, overageDesigns, PRICE } from '@/lib/plans';
import { hasStripe } from '@/lib/stripe';

// A brand's plan and this month's Studio designs.
// GET ?workspace_id=…   PATCH {workspace_id, overage_cap_pence} (owners)
// DELETE ?workspace_id=… stops a Pro subscription now (owners; used just before deleting the brand).
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get('workspace_id') || '';
  const who = await whoFor(id);
  if (!who.user) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  if (!who.ws) return Response.json({ error: 'Workspace not found.' }, { status: 404 });
  const db = createAdminClient();
  const row = await billingRow(db, id);
  const billing = toBilling(row);
  const month = new Date(); month.setUTCDate(1);
  const { data: u } = await db.from('ai_usage').select('used').eq('workspace_id', id).eq('month', month.toISOString().slice(0, 10)).eq('kind', 'design').maybeSingle();
  const used = u?.used || 0;
  const allowance = designAllowance(billing.plan);
  const extra = Math.max(0, used - allowance);
  return Response.json({
    billing,
    role: who.role,
    stripe: hasStripe(),
    designs: {
      used, allowance, extra,
      extra_pence: extra * PRICE.overage,
      extra_left: Math.max(0, overageDesigns(billing.plan, billing.overage_cap_pence) - extra),
      resets: new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 1)).toISOString(),
    },
  });
}

export async function PATCH(request: Request) {
  const b = await request.json().catch(() => null);
  const who = await whoFor(String(b?.workspace_id || ''));
  if (!who.user) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  if (who.role !== 'owner') return Response.json({ error: 'Only owners can change billing.' }, { status: 403 });
  const cap = Math.round(Number(b?.overage_cap_pence));
  if (!(cap >= 0 && cap <= 1000000)) return Response.json({ error: 'The cap must be between £0 and £10,000.' }, { status: 400 });
  const db = createAdminClient();
  const { error } = await db.from('workspace_billing').upsert({ workspace_id: who.ws!.id, overage_cap_pence: cap, updated_at: new Date().toISOString() }, { onConflict: 'workspace_id' });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, overage_cap_pence: cap });
}

export async function DELETE(request: Request) {
  const who = await whoFor(new URL(request.url).searchParams.get('workspace_id') || '');
  if (!who.user) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  if (who.role !== 'owner') return Response.json({ error: 'Only owners can do that.' }, { status: 403 });
  try { await cancelNow(createAdminClient(), who.ws!.id); } catch (e: any) { return Response.json({ error: e?.message || 'Couldn’t stop the subscription.' }, { status: 502 }); }
  return Response.json({ ok: true });
}
