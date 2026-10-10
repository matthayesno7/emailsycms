import { safe } from '@/lib/safeRoute';
import { member } from '@/lib/makeAuth';
import { runTool } from '@/lib/boardTools';

// A board's Tools menu: POST { workspace_id, tool, asset_id, rect?, shape?, sizes?, edits?, scale?, colour? }
export const runtime = 'nodejs';
export const maxDuration = 300;

export const POST = safe('board/tool', async (request: Request) => {
  const b = await request.json().catch(() => null);
  const ws = String(b?.workspace_id || '');
  const m = await member(ws);
  if ('error' in m) return m.error;
  const r = await runTool(m.repo, m.db, { wsId: ws, userId: m.user.id, tool: b?.tool, assetId: b?.asset_id, rect: b?.rect, shape: b?.shape, sizes: b?.sizes, edits: b?.edits, scale: b?.scale, colour: b?.colour, purpose: b?.purpose });
  if ('error' in r) return Response.json({ error: r.error, code: r.code }, { status: r.status });
  return Response.json(r);
});
