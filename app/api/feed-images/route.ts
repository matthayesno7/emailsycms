import { createClient } from '@/lib/supabase/server';
import { feedImageBatch } from '@/lib/feedImages';

// Downloads product images from a feed's image_link URLs into storage.
// The browser can't do this itself (other sites block cross-origin reads), so the server fetches them.
// Handles a batch per call; the client calls again while `remaining` > 0.

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const ws = String(body?.workspace_id || '');
  const skip: string[] = Array.isArray(body?.skip) ? body.skip.map(String).slice(0, 5000) : [];
  if (!ws) return Response.json({ error: 'Missing workspace.' }, { status: 400 });
  // Row level security limits this to workspaces the user belongs to.
  const r = await feedImageBatch(supabase, ws, skip);
  if ('error' in r) return Response.json({ error: r.error }, { status: 400 });
  return Response.json(r);
}
