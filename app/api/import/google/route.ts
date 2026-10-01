import { createClient } from '@/lib/supabase/server';
import { fetchLimited } from '@/lib/net';
import { importContext, importFile, isImportable, resolveFolder } from '@/lib/importer';

// Files picked with the Google Picker. The browser holds a short-lived token limited to the
// files the person picked (drive.file scope); the server uses it once to copy them in.
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createClient();
  const body = await request.json().catch(() => null);
  const ctx = await importContext(supabase, body);
  if ('error' in ctx) return Response.json({ error: ctx.error }, { status: ctx.status });
  const token = String(body?.token || '');
  if (!token) return Response.json({ error: 'Missing Google access.' }, { status: 400 });
  const files: any[] = Array.isArray(body?.files) ? body.files.slice(0, 12) : [];
  const folderId = await resolveFolder(supabase, ctx.ws, ctx.user.id, body?.folder_id || null);
  const results = await Promise.all(files.map(async (f) => {
    const id = String(f?.id || '');
    const name = String(f?.name || 'file');
    if (!/^[\w-]{10,}$/.test(id)) return { name, error: 'Bad file id' };
    if (!isImportable(name, f?.mimeType)) return { name, error: 'Not an image or video' };
    const got = await fetchLimited(`https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`, {
      headers: { authorization: `Bearer ${token}` }, maxBytes: 100 * 1024 * 1024, timeoutMs: 45000,
    });
    if ('error' in got) return { name, error: got.error };
    const r = await importFile(supabase, { ws: ctx.ws, userId: ctx.user.id, folderId, name, buf: got.buf, type: f?.mimeType || got.type, source: 'google', externalId: id, path: name });
    return { name, ...r };
  }));
  return Response.json({ results });
}
