import { createClient } from './supabase/server';
import { can, NEEDS } from './roles';

// The signed-in person and their role in a brand, for API routes that write with the service role.
// Returns an error Response when they aren't signed in, aren't a member, or their role can't do it.
export async function needRole(ws: string, level: keyof typeof can) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: Response.json({ error: 'Sign in first.' }, { status: 401 }) };
  const { data: m } = ws ? await supabase.from('workspace_members').select('role, workspaces(id, name, slug)').eq('workspace_id', ws).eq('user_id', user.id).maybeSingle() : { data: null };
  if (!m) return { error: Response.json({ error: 'Workspace not found.' }, { status: 404 }) };
  if (!can[level](m.role)) return { error: Response.json({ error: NEEDS[level], code: 'role' }, { status: 403 }) };
  return { user, role: m.role as string, ws: (m as any).workspaces as { id: string; name: string; slug: string } };
}
