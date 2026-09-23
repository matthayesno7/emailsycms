import { createAdminClient } from '@/lib/supabase/admin';
import { hashKey } from '@/lib/keys';
import { handleBody } from '@/lib/mcp/server';
import { supabaseRepo } from '@/lib/mcp/repo';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// MCP endpoint (streamable HTTP, stateless, JSON responses).
// The connector URL carries the user's personal key: /api/mcp/<key>
export async function POST(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const db = createAdminClient();
  const { data: apiKey } = await db.from('api_keys').select('id, user_id').eq('key_hash', hashKey(key || '')).maybeSingle();
  if (!apiKey) {
    return Response.json(
      { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'This connector link is not valid. Create a new one in Emailsy CMS → Claude connector.' } },
      { status: 401 },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, { status: 400 });
  }
  await db.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', apiKey.id);
  const result = await handleBody(body, { repo: supabaseRepo(db), userId: apiKey.user_id });
  if (!result) return new Response(null, { status: 202 });
  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
}

export function GET() {
  // No server-initiated stream; clients fall back to plain request/response.
  return new Response('Method not allowed', { status: 405, headers: { Allow: 'POST' } });
}

export function DELETE() {
  return new Response(null, { status: 405, headers: { Allow: 'POST' } });
}
