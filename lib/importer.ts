// Server side: copies a file from a cloud drive into a workspace's library.
import { MAX_IMAGE_BYTES } from './plans';
import type { SupabaseClient } from '@supabase/supabase-js';
import { imageSize } from './imageSize';
import { IMAGE_EXT } from './net';

export const IMPORTABLE = /^(image\/(png|jpeg|webp|gif|svg\+xml|avif)|video\/(mp4|webm|quicktime))$/;
const VIDEO_EXT: Record<string, string> = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };

export function typeFromName(name: string, fallback = '') {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
  return ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' } as Record<string, string>)[ext] || fallback;
}

export function isImportable(name: string, mime?: string) {
  const t = mime && IMPORTABLE.test(mime) ? mime : typeFromName(name);
  return IMPORTABLE.test(t);
}

// db must be allowed to write to the workspace (user client with RLS, or service role after a membership check).
export async function importFile(db: SupabaseClient, o: {
  ws: string; userId: string; folderId: string | null; name: string; buf: Buffer; type: string;
  source: 'dropbox' | 'google' | 'box'; externalId: string; path?: string;
}): Promise<{ id?: string; skipped?: boolean; error?: string }> {
  const type = IMPORTABLE.test(o.type) ? o.type : typeFromName(o.name, o.type);
  if (!IMPORTABLE.test(type)) return { error: 'Not an image or video' };
  // Imported before: don't add it twice.
  const { data: prior } = await db.from('assets').select('id').eq('workspace_id', o.ws).contains('provenance', { source: o.source, external_id: o.externalId }).limit(1);
  if (prior?.[0]) return { id: prior[0].id, skipped: true };
  const video = type.startsWith('video/');
  if (!video && o.buf.length > MAX_IMAGE_BYTES) return { error: 'Over 50 MB (the most Mise takes for an image)' };
  const ext = IMAGE_EXT[type] || VIDEO_EXT[type] || 'bin';
  const storagePath = `${o.ws}/${crypto.randomUUID()}.${ext}`;
  const up = await db.storage.from('assets').upload(storagePath, o.buf, { contentType: type });
  if (up.error) return { error: /size|large/i.test(up.error.message) ? 'Too large' : up.error.message };
  const size = video ? null : imageSize(o.buf);
  const base = o.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim().slice(0, 120) || 'Imported file';
  const kind = video ? 'video' : /logo|wordmark|brandmark/i.test(base) || type === 'image/svg+xml' ? 'logo' : 'image';
  const { data, error } = await db.from('assets').insert({
    workspace_id: o.ws, kind, name: base, storage_path: storagePath, mime: type, bytes: o.buf.length,
    width: size?.w ?? null, height: size?.h ?? null, folder_id: o.folderId, origin: 'uploaded', status: 'approved', created_by: o.userId,
    provenance: { via: 'import', source: o.source, external_id: o.externalId, path: o.path || null, imported_at: new Date().toISOString() },
  }).select('id').single();
  if (error) return { error: error.message };
  return { id: data.id };
}

// The folder to import into: an existing Mise folder id, or a new folder by name (e.g. the Box folder's name).
export async function resolveFolder(db: SupabaseClient, ws: string, userId: string, folderId?: string | null, folderName?: string | null) {
  if (folderName) {
    const n = folderName.trim().slice(0, 60);
    const { data: existing } = await db.from('folders').select('id').eq('workspace_id', ws).ilike('name', n).limit(1);
    if (existing?.[0]) return existing[0].id as string;
    const { data } = await db.from('folders').insert({ workspace_id: ws, name: n, created_by: userId }).select('id').single();
    return (data?.id as string) || null;
  }
  return folderId || null;
}

// Common checks for every import route.
export async function importContext(supabase: SupabaseClient, body: any) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Sign in first.', status: 401 } as const;
  const ws = String(body?.workspace_id || '');
  const { data: workspace } = await supabase.from('workspaces').select('id').eq('id', ws).maybeSingle();
  if (!workspace) return { error: 'Workspace not found.', status: 404 } as const;
  return { user, ws } as const;
}
