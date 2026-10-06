import { can, NEEDS } from './roles';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { supabaseRepo } from '@/lib/mcp/repo';

// Who's asking, and can they see this brand (row level security decides).
export async function member(ws: string, level: 'any' | 'add' = 'add') {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: Response.json({ error: 'Sign in first.' }, { status: 401 }) };
  const { data } = await supabase.from('workspaces').select('id').eq('id', ws).maybeSingle();
  if (!data) return { error: Response.json({ error: 'Workspace not found.' }, { status: 404 }) };
  if (level === 'add') {
    const { data: m } = await supabase.from('workspace_members').select('role').eq('workspace_id', ws).eq('user_id', user.id).maybeSingle();
    if (!can.add(m?.role)) return { error: Response.json({ error: NEEDS.add, code: 'role' }, { status: 403 }) };
  }
  const db = createAdminClient();
  return { user, db, repo: supabaseRepo(db) };
}

