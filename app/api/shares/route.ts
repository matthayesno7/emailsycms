import { createClient } from '@/lib/supabase/server';
import { freeBrand } from '@/lib/billing';
import { createAdminClient } from '@/lib/supabase/admin';
import { FORMATS, hashPasscode, newToken } from '@/lib/share';

// Share links. POST creates one; PATCH changes or revokes one. Listing and deleting happen
// in the app through row level security; this route exists because passcodes are hashed here.
export const runtime = 'nodejs';

async function member(ws: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: Response.json({ error: 'Sign in first.' }, { status: 401 }) };
  const { data } = await supabase.from('workspaces').select('id').eq('id', ws).maybeSingle();
  if (!data) return { error: Response.json({ error: 'Workspace not found.' }, { status: 404 }) };
  return { user };
}

const formats = (v: unknown) => {
  const f = (Array.isArray(v) ? v : FORMATS).map(String).filter((x) => (FORMATS as readonly string[]).includes(x));
  return f.length ? f : ['original'];
};
const expiry = (v: unknown) => {
  if (v === null || v === '' || v === undefined) return null;
  const d = new Date(String(v));
  return isNaN(+d) ? null : d.toISOString();
};
const uuid = (v: unknown) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

export async function POST(request: Request) {
  const b = await request.json().catch(() => ({}));
  const ws = uuid(b?.workspace_id);
  if (!ws) return Response.json({ error: 'Workspace not found.' }, { status: 404 });
  const m = await member(ws);
  if (m.error) return m.error;
  if (await freeBrand(ws)) return Response.json({ error: 'Sharing is on Pro. Start your 7-day free trial to share.', code: 'upgrade', reason: 'share' }, { status: 402 });
  const kind = ['assets', 'folder', 'collection'].includes(b?.kind) ? b.kind : 'assets';
  const db = createAdminClient();
  const row: Record<string, any> = {
    workspace_id: ws, token: newToken(), kind,
    title: String(b?.title || 'Shared files').trim().slice(0, 120) || 'Shared files',
    message: b?.message ? String(b.message).slice(0, 1000) : null,
    expires_at: expiry(b?.expires_at),
    passcode_hash: b?.passcode ? hashPasscode(String(b.passcode).slice(0, 100)) : null,
    allow_download: b?.allow_download !== false,
    formats: formats(b?.formats),
    created_by: m.user.id,
  };
  // Everything shared must belong to this workspace.
  if (kind === 'assets') {
    const ids = (Array.isArray(b?.asset_ids) ? b.asset_ids : []).map(uuid).filter(Boolean).slice(0, 500) as string[];
    const { data } = await db.from('assets').select('id').eq('workspace_id', ws).in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
    const ok = new Set((data || []).map((r: any) => r.id));
    row.asset_ids = ids.filter((id) => ok.has(id));
    if (!row.asset_ids.length) return Response.json({ error: 'Pick at least one file to share.' }, { status: 400 });
  } else {
    const id = uuid(kind === 'folder' ? b?.folder_id : b?.collection_id);
    const { data } = id ? await db.from(kind === 'folder' ? 'folders' : 'collections').select('id').eq('workspace_id', ws).eq('id', id).maybeSingle() : { data: null };
    if (!data) return Response.json({ error: `That ${kind} isn’t in this workspace.` }, { status: 400 });
    row[kind === 'folder' ? 'folder_id' : 'collection_id'] = id;
  }
  const { data, error } = await db.from('shares').insert(row).select('id, token, title, kind, expires_at, allow_download, formats, created_at').single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ share: { ...data, has_passcode: !!row.passcode_hash } });
}

export async function PATCH(request: Request) {
  const b = await request.json().catch(() => ({}));
  const id = uuid(b?.id);
  const db = createAdminClient();
  const { data: s } = id ? await db.from('shares').select('id, workspace_id').eq('id', id).maybeSingle() : { data: null };
  if (!s) return Response.json({ error: 'Link not found.' }, { status: 404 });
  const m = await member(s.workspace_id);
  if (m.error) return m.error;
  const patch: Record<string, any> = {};
  if (b.revoke === true) patch.revoked_at = new Date().toISOString();
  if (b.restore === true) patch.revoked_at = null;
  if ('title' in b) patch.title = String(b.title || 'Shared files').slice(0, 120);
  if ('message' in b) patch.message = b.message ? String(b.message).slice(0, 1000) : null;
  if ('expires_at' in b) patch.expires_at = expiry(b.expires_at);
  if ('passcode' in b) patch.passcode_hash = b.passcode ? hashPasscode(String(b.passcode).slice(0, 100)) : null;
  if ('allow_download' in b) patch.allow_download = b.allow_download !== false;
  if ('formats' in b) patch.formats = formats(b.formats);
  const { error } = await db.from('shares').update(patch).eq('id', s.id);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ ok: true });
}
