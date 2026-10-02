import { createClient } from '@/lib/supabase/server';
import { notify } from '@/lib/notify';

// In-app feedback: saved in the feedback table and emailed to ALERT_EMAIL (FEEDBACK_EMAIL if set).
const KINDS = ['bug', 'idea', 'question', 'praise'] as const;
const LABEL: Record<string, string> = { bug: 'Something’s broken', idea: 'Idea', question: 'Question', praise: 'Praise' };

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const message = String(body?.message || '').trim().slice(0, 4000);
  if (!message) return Response.json({ error: 'Write a few words first.' }, { status: 400 });
  const kind = (KINDS as readonly string[]).includes(body?.kind) ? body.kind : 'idea';
  const page = String(body?.page || '').slice(0, 300);
  let ws: string | null = String(body?.workspace_id || '') || null;
  let wsName = '';
  if (ws) {
    // Row level security: keep the workspace only if this user is a member.
    const { data } = await supabase.from('workspaces').select('id, name').eq('id', ws).maybeSingle();
    ws = data?.id || null; wsName = data?.name || '';
  }
  const { error } = await supabase.from('feedback').insert({
    user_id: user.id, email: user.email, workspace_id: ws, kind, message, page, user_agent: (request.headers.get('user-agent') || '').slice(0, 300),
  });
  if (error) return Response.json({ error: 'Couldn’t send that. Try again in a moment.' }, { status: 500 });
  void notify(
    `Mise feedback (${LABEL[kind]}) from ${user.email}${wsName ? ` · ${wsName}` : ''}`,
    `${message}\n\n—\nFrom: ${user.email}\nBrand: ${wsName || 'none'}${ws ? ` (${ws})` : ''}\nPage: ${page || 'unknown'}\nBrowser: ${request.headers.get('user-agent') || ''}`,
    { replyTo: user.email || undefined, to: process.env.FEEDBACK_EMAIL || undefined },
  );
  return Response.json({ ok: true });
}
