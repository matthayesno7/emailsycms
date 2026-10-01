import { createClient } from '@/lib/supabase/server';
import { fetchLimited } from '@/lib/net';
import { boxToken } from '@/lib/box';
import { importContext, importFile, isImportable, resolveFolder } from '@/lib/importer';

// Copy a batch of Box files in. folder_name puts them in a Mise folder of that name (a Box folder import).
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createClient();
  const body = await request.json().catch(() => null);
  const ctx = await importContext(supabase, body);
  if ('error' in ctx) return Response.json({ error: ctx.error }, { status: ctx.status });
  const token = await boxToken(ctx.user.id);
  if (!token) return Response.json({ error: 'not_connected' }, { status: 409 });
  const files: any[] = Array.isArray(body?.files) ? body.files.slice(0, 12) : [];
  const folderId = await resolveFolder(supabase, ctx.ws, ctx.user.id, body?.folder_id || null, body?.folder_name || null);
  const results = await Promise.all(files.map(async (f) => {
    const id = String(f?.id || ''), name = String(f?.name || 'file');
    if (!/^\d+$/.test(id)) return { name, error: 'Bad file id' };
    if (!isImportable(name)) return { name, error: 'Not an image or video' };
    const got = await fetchLimited(`https://api.box.com/2.0/files/${id}/content`, { headers: { authorization: `Bearer ${token}` }, maxBytes: 100 * 1024 * 1024, timeoutMs: 45000 });
    if ('error' in got) return { name, error: got.error };
    const r = await importFile(supabase, { ws: ctx.ws, userId: ctx.user.id, folderId, name, buf: got.buf, type: got.type, source: 'box', externalId: id, path: f?.path || name });
    return { name, ...r };
  }));
  return Response.json({ results, folder_id: folderId });
}
