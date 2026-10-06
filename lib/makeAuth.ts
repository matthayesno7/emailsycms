import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { supabaseRepo } from '@/lib/mcp/repo';

// Who's asking, and can they see this brand (row level security decides).
export async function member(ws: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: Response.json({ error: 'Sign in first.' }, { status: 401 }) };
  const { data } = await supabase.from('workspaces').select('id').eq('id', ws).maybeSingle();
  if (!data) return { error: Response.json({ error: 'Workspace not found.' }, { status: 404 }) };
  const db = createAdminClient();
  return { user, db, repo: supabaseRepo(db) };
}

