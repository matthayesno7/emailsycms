import { createClient } from '@/lib/supabase/server';
import { capFor, LABEL, type UsageKind } from '@/lib/usage';
import { effectivePlan } from '@/lib/plans';

// This month's AI usage for a workspace, against its allowances (Settings → Auto-organise).
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const ws = new URL(request.url).searchParams.get('workspace_id') || '';
  // Row level security: only members get the workspace (and its usage rows) back.
  const { data: w } = await supabase.from('workspaces').select('id, ai_caps').eq('id', ws).maybeSingle();
  if (!w) return Response.json({ error: 'Workspace not found.' }, { status: 404 });
  const month = new Date(); month.setUTCDate(1);
  const { data: rows } = await supabase.from('ai_usage').select('kind, used').eq('workspace_id', ws).eq('month', month.toISOString().slice(0, 10));
  const { data: b } = await supabase.from('workspace_billing').select('plan, subscription_status').eq('workspace_id', ws).maybeSingle();
  const plan = effectivePlan(b);
  const used = new Map((rows || []).map((r: any) => [r.kind, r.used as number]));
  const kinds: UsageKind[] = ['tag', 'search', 'design', 'kit'];
  return Response.json({
    usage: kinds.map((k) => ({ kind: k, label: LABEL[k], used: used.get(k) || 0, cap: Number((w.ai_caps as any)?.[k]) || capFor(k, plan) })),
    plan,
  });
}
