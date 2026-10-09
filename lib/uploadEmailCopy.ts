// The email-ready copy (max 1200px wide) of an edited or new image, uploaded next to it. Server only.
// Its own file so the Claude connector (lib/mcp/more.ts) and "Make…" (lib/runAction.ts) share it
// without importing each other.
import type { SupabaseClient } from '@supabase/supabase-js';
import { emailCopy } from './serverImage';

export async function uploadEmailCopy(db: SupabaseClient, wsId: string, buf: Buffer, mime: string) {
  const e = await emailCopy(buf, mime);
  if (!e) return {};
  const path = `${wsId}/email/${crypto.randomUUID()}.${e.format}`;
  const { error } = await db.storage.from('assets').upload(path, e.buf, { contentType: e.mime });
  return error ? {} : { email: { path, width: e.width, height: e.height, bytes: e.buf.length, format: e.format } };
}
