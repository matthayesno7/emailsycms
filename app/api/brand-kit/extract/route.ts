import { createClient } from '@/lib/supabase/server';
import { brandKitFromWebsite } from '@/lib/brandFromSite';

// Builds a draft brand kit from a website (see lib/brandFromSite.ts).
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const ws = String(body?.workspace_id || '');
  if (!ws || !String(body?.url || '').trim()) return Response.json({ error: 'Add a website address, like yourbrand.com.' }, { status: 400 });

  // Row level security: only returns the workspace if the user is a member.
  const { data: workspace } = await supabase.from('workspaces').select('id, name').eq('id', ws).maybeSingle();
  if (!workspace) return Response.json({ error: 'Workspace not found.' }, { status: 404 });

  const r = await brandKitFromWebsite(supabase, workspace, user.id, String(body.url));
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  const { ok, ...out } = r;
  return Response.json(out);
}
