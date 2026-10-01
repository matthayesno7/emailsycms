import { createClient } from '@/lib/supabase/server';
import { fetchLimited } from '@/lib/net';
import { importContext, importFile, isImportable, resolveFolder } from '@/lib/importer';

// Files picked with the Dropbox Chooser arrive as short-lived direct links; the server copies them in.
export const runtime = 'nodejs';
export const maxDuration = 60;

const DROPBOX_HOSTS = /(^|\.)dropboxusercontent\.com$|(^|\.)dropbox\.com$/;

export async function POST(request: Request) {
  const supabase = await createClient();
  const body = await request.json().catch(() => null);
  const ctx = await importContext(supabase, body);
  if ('error' in ctx) return Response.json({ error: ctx.error }, { status: ctx.status });
  const files: any[] = Array.isArray(body?.files) ? body.files.slice(0, 12) : [];
  const folderId = await resolveFolder(supabase, ctx.ws, ctx.user.id, body?.folder_id || null);
  const results = await Promise.all(files.map(async (f) => {
    const name = String(f?.name || 'file');
    let host = '';
    try { host = new URL(String(f?.link)).hostname; } catch {}
    if (!DROPBOX_HOSTS.test(host)) return { name, error: 'Not a Dropbox link' };
    if (!isImportable(name)) return { name, error: 'Not an image or video' };
    const got = await fetchLimited(String(f.link), { maxBytes: 100 * 1024 * 1024, timeoutMs: 45000 });
    if ('error' in got) return { name, error: got.error };
    const r = await importFile(supabase, { ws: ctx.ws, userId: ctx.user.id, folderId, name, buf: got.buf, type: got.type, source: 'dropbox', externalId: String(f.id || f.link), path: name });
    return { name, ...r };
  }));
  return Response.json({ results });
}
