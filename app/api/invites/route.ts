import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { appUrl } from '@/lib/keys';

// Invite a teammate to a workspace. Owners only (enforced by row level security on the insert).
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Sign in first.' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const email = String(body?.email || '').trim().toLowerCase();
  const workspaceId = String(body?.workspaceId || '');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return Response.json({ error: 'Enter a valid email address.' }, { status: 400 });

  const { error } = await supabase
    .from('workspace_invites')
    .upsert({ workspace_id: workspaceId, email, role: 'editor', invited_by: user.id, accepted_at: null }, { onConflict: 'workspace_id,email' });
  if (error) return Response.json({ error: 'Only workspace owners can invite people.' }, { status: 403 });

  // New people get an invite email from Supabase; people who already have an account
  // see the workspace the next time they open the app.
  const admin = createAdminClient();
  const { error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${appUrl()}/login` });
  const existing = !!inviteError && /already|registered|exists/i.test(inviteError.message);
  if (inviteError && !existing) return Response.json({ error: inviteError.message }, { status: 400 });
  return Response.json({ ok: true, existing });
}
