import { member } from '@/lib/makeAuth';
import { clipStatus, startClip } from '@/lib/makeMedia';

// Create: video clips made in Mise. POST starts one; GET ?workspace_id&job says when it's ready.
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const m = await member(String(body?.workspace_id || ''));
  if ('error' in m) return m.error;
  const r = await startClip(m.repo, m.db, {
    wsId: String(body.workspace_id), userId: m.user.id, prompt: String(body?.prompt || ''),
    referenceId: body?.reference_id ? String(body.reference_id) : null, aspect: body?.aspect, seconds: body?.seconds, name: body?.name,
  });
  if ('error' in r) return Response.json({ error: r.error, code: r.code }, { status: r.status });
  return Response.json(r);
}

export async function GET(request: Request) {
  const u = new URL(request.url);
  const ws = u.searchParams.get('workspace_id') || '';
  const m = await member(ws, 'any');
  if ('error' in m) return m.error;
  const r = await clipStatus(m.repo, m.db, ws, m.user.id, u.searchParams.get('job') || '');
  if ('error' in r) return Response.json({ error: r.error }, { status: r.status });
  if (!r.ready) return Response.json({ ready: false });
  return Response.json({ ready: true, asset: { id: r.asset.row.id, name: r.asset.row.name, url: r.asset.url }, model: r.asset.row.provenance?.model || null });
}
