// Box: OAuth tokens (kept server-side) and the few API calls the importer needs.
import { createAdminClient } from './supabase/admin';

const API = 'https://api.box.com/2.0';

export async function boxToken(userId: string): Promise<string | null> {
  const db = createAdminClient();
  const { data } = await db.from('connections').select('*').eq('user_id', userId).eq('provider', 'box').maybeSingle();
  if (!data) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() > Date.now() + 60_000) return data.access_token;
  // Refresh (Box access tokens last about an hour; refresh tokens about 60 days, and rotate).
  const res = await fetch('https://api.box.com/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: data.refresh_token || '', client_id: process.env.BOX_CLIENT_ID!, client_secret: process.env.BOX_CLIENT_SECRET! }),
  });
  if (!res.ok) { await db.from('connections').delete().eq('id', data.id); return null; }
  const t = await res.json();
  await db.from('connections').update({ access_token: t.access_token, refresh_token: t.refresh_token, expires_at: new Date(Date.now() + (t.expires_in || 3600) * 1000).toISOString(), updated_at: new Date().toISOString() }).eq('id', data.id);
  return t.access_token;
}

export async function boxGet(token: string, path: string) {
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Box ${res.status}`);
  return res.json();
}

export type BoxItem = { type: 'file' | 'folder'; id: string; name: string; size?: number };

export async function boxList(token: string, folderId: string): Promise<BoxItem[]> {
  const out: BoxItem[] = [];
  for (let offset = 0; offset < 5000; offset += 1000) {
    const page = await boxGet(token, `/folders/${encodeURIComponent(folderId)}/items?fields=type,id,name,size&limit=1000&offset=${offset}`);
    out.push(...(page.entries || []));
    if (out.length >= (page.total_count || 0)) break;
  }
  return out;
}

// Every file under a folder (and its subfolders), up to a sensible cap.
export async function boxWalk(token: string, folderId: string, prefix = '', cap = 2000): Promise<(BoxItem & { path: string })[]> {
  const out: (BoxItem & { path: string })[] = [];
  const queue: [string, string][] = [[folderId, prefix]];
  while (queue.length && out.length < cap) {
    const [id, pre] = queue.shift()!;
    for (const it of await boxList(token, id)) {
      if (it.type === 'folder') queue.push([it.id, `${pre}${it.name}/`]);
      else out.push({ ...it, path: `${pre}${it.name}` });
    }
  }
  return out.slice(0, cap);
}
