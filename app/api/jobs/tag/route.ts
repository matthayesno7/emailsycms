import { after } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { canTag, runEmbeds, runQueue } from '@/lib/autotagWorker';
import { hasVoyage } from '@/lib/search';
import { COST_PER_FILE_GBP } from '@/lib/autotag';

// Auto-organise for one workspace.
// GET  ?workspace_id=…  progress: organised, waiting, failed, not organised yet.
// POST {workspace_id, action}  'kick' (default): work through what's waiting now;
//      'backfill': queue every file not organised yet; 'retry': queue the failed ones again.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ELIGIBLE = ['image', 'logo', 'product'];

async function member(request: Request, wsFrom: (u: URL, body: any) => string, body?: any) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: Response.json({ error: 'Sign in first.' }, { status: 401 }) };
  const ws = wsFrom(new URL(request.url), body);
  const { data: workspace } = await supabase.from('workspaces').select('id').eq('id', ws).maybeSingle();
  if (!workspace) return { error: Response.json({ error: 'Workspace not found.' }, { status: 404 }) };
  return { supabase, ws };
}

async function progress(supabase: any, ws: string) {
  const base = () => supabase.from('assets').select('id', { count: 'exact', head: true }).eq('workspace_id', ws).in('kind', ELIGIBLE).not('storage_path', 'is', null);
  const all = () => supabase.from('assets').select('id', { count: 'exact', head: true }).eq('workspace_id', ws).neq('kind', 'block');
  const [organised, waiting, failed, notYet, searchAll, searchWaiting] = await Promise.all([
    base().in('ai_status', ['done', 'skipped']),
    base().in('ai_status', ['pending', 'processing']),
    base().eq('ai_status', 'failed'),
    base().is('ai_status', null),
    all(),
    all().eq('embed_pending', true),
  ]);
  const n = (r: any) => r.count || 0;
  return {
    enabled: canTag(),
    organised: n(organised), waiting: n(waiting), failed: n(failed), not_yet: n(notYet),
    total: n(organised) + n(waiting) + n(failed) + n(notYet),
    cost_per_file_gbp: COST_PER_FILE_GBP,
    search_enabled: hasVoyage(),
    searchable: n(searchAll) - n(searchWaiting), search_waiting: n(searchWaiting),
  };
}

export async function GET(request: Request) {
  const m = await member(request, (u) => u.searchParams.get('workspace_id') || '');
  if (m.error) return m.error;
  const p = await progress(m.supabase, m.ws);
  // Recent failures, so Settings can say why.
  const { data: errors } = await m.supabase.from('assets').select('id, name, ai_error').eq('workspace_id', m.ws).eq('ai_status', 'failed').order('updated_at', { ascending: false }).limit(5);
  return Response.json({ ...p, errors: errors || [] });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const m = await member(request, (_u, b) => String(b?.workspace_id || ''), body);
  if (m.error) return m.error;
  if (!canTag() && !hasVoyage()) return Response.json({ error: 'Auto-organise needs ANTHROPIC_API_KEY set on the server.' }, { status: 501 });
  const action = String(body?.action || 'kick');
  if (action === 'backfill') {
    const { error } = await m.supabase.from('assets').update({ ai_status: 'pending', ai_attempts: 0, ai_error: null })
      .eq('workspace_id', m.ws).in('kind', ELIGIBLE).not('storage_path', 'is', null).is('ai_status', null);
    if (error) return Response.json({ error: error.message }, { status: 400 });
  } else if (action === 'retry') {
    const { error } = await m.supabase.from('assets').update({ ai_status: 'pending', ai_attempts: 0, ai_error: null })
      .eq('workspace_id', m.ws).eq('ai_status', 'failed');
    if (error) return Response.json({ error: error.message }, { status: 400 });
  }
  // Answer now; the work carries on in the background.
  after(() => runQueue({ ws: m.ws, budgetMs: 45_000 }).catch((e) => console.error('[autotag]', e)).then(() => runEmbeds({ ws: m.ws, budgetMs: 20_000 })));
  return Response.json(await progress(m.supabase, m.ws));
}
