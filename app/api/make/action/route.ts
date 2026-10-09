import { safe } from '@/lib/safeRoute';
import { member } from '@/lib/makeAuth';
import { runAction } from '@/lib/runAction';

// Board actions on library images: POST { workspace_id, action, asset_ids[], choice?, detail?, sizes? }
// AI results are saved as drafts for Review; resized copies keep the original's status.
export const runtime = 'nodejs';
export const maxDuration = 300;

export const POST = safe('make/action', async (request: Request) => {
  const b = await request.json().catch(() => null);
  const ws = String(b?.workspace_id || '');
  const m = await member(ws);
  if ('error' in m) return m.error;
  const { data: me } = await m.db.from('workspace_members').select('role').eq('workspace_id', ws).eq('user_id', m.user.id).maybeSingle();
  const r = await runAction(m.repo, m.db, { wsId: ws, userId: m.user.id, role: me?.role || '', action: b?.action, assetIds: b?.asset_ids, choice: b?.choice, detail: b?.detail, sizes: b?.sizes });
  if ('error' in r) return Response.json({ error: r.error, code: r.code }, { status: r.status });
  return Response.json(r);
});
