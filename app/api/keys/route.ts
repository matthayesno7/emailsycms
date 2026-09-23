import { createClient } from '@/lib/supabase/server';
import { appUrl, newApiKey } from '@/lib/keys';

// Create a personal connector link for Claude. The full key is shown once and only its hash is stored.
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const name = String(body?.name || 'Claude').slice(0, 40);
  const { key, prefix, hash } = newApiKey();
  const { data, error } = await supabase
    .from('api_keys')
    .insert({ user_id: user.id, name, prefix, key_hash: hash })
    .select('id, name, prefix, created_at, last_used_at')
    .single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ key: data, url: `${appUrl()}/api/mcp/${key}` });
}
