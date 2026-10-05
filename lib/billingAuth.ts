import { createClient } from './supabase/server';

// The signed-in user and their role in a brand (null when they aren't a member).
export async function whoFor(ws: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, role: null as string | null, ws: null as { id: string; name: string } | null };
  if (!ws) return { user, role: null, ws: null };
  // Row level security: only members get the workspace and their own membership back.
  const [{ data: w }, { data: m }] = await Promise.all([
    supabase.from('workspaces').select('id, name').eq('id', ws).maybeSingle(),
    supabase.from('workspace_members').select('role').eq('workspace_id', ws).eq('user_id', user.id).maybeSingle(),
  ]);
  return { user, role: w ? ((m?.role as string) || 'editor') : null, ws: w as { id: string; name: string } | null };
}
