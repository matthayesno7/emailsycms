import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { FORMATS, hashPasscode } from '@/lib/share';

// Brand portals. POST creates one (ready to share straight away: everything approved, styled
// from the brand kit, with a guidelines page); PATCH changes one. Reading, analytics and
// deleting happen in the app through row level security.
export const runtime = 'nodejs';

const uuid = (v: unknown) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
const slugify = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'portal';
const emails = (v: unknown) => (Array.isArray(v) ? v : String(v || '').split(/[\s,;]+/))
  .map((x) => String(x).trim().toLowerCase()).filter((x) => /^(@[\w.-]+\.[a-z]{2,}|[^@\s]+@[\w.-]+\.[a-z]{2,})$/.test(x)).slice(0, 500);

async function member(ws: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: Response.json({ error: 'Sign in first.' }, { status: 401 }) };
  const { data } = await supabase.from('workspaces').select('id, name, slug').eq('id', ws).maybeSingle();
  if (!data) return { error: Response.json({ error: 'Workspace not found.' }, { status: 404 }) };
  return { user, ws: data };
}

// Fields a person can set, checked and cleaned. Ids must belong to the workspace.
async function fields(db: any, ws: string, b: any) {
  const out: Record<string, any> = {};
  if ('name' in b) out.name = String(b.name || 'Brand portal').trim().slice(0, 80) || 'Brand portal';
  if ('slug' in b) out.slug = slugify(String(b.slug || ''));
  if ('intro' in b) out.intro = b.intro ? String(b.intro).slice(0, 1000) : null;
  if ('include_all' in b) out.include_all = !!b.include_all;
  if ('show_guidelines' in b) out.show_guidelines = !!b.show_guidelines;
  if ('published' in b) out.published = !!b.published;
  if ('allow_download' in b) out.allow_download = !!b.allow_download;
  if ('formats' in b) { const f = (Array.isArray(b.formats) ? b.formats : []).filter((x: string) => (FORMATS as readonly string[]).includes(x)); out.formats = f.length ? f : ['original']; }
  if ('access' in b && ['public', 'passcode', 'allowlist'].includes(b.access)) out.access = b.access;
  if ('allowlist' in b) out.allowlist = emails(b.allowlist);
  if ('passcode' in b) out.passcode_hash = b.passcode ? hashPasscode(String(b.passcode).slice(0, 100)) : null;
  for (const [key, table] of [['folder_ids', 'folders'], ['collection_ids', 'collections']] as const) {
    if (!(key in b)) continue;
    const ids = (Array.isArray(b[key]) ? b[key] : []).map(uuid).filter(Boolean).slice(0, 200);
    const { data } = ids.length ? await db.from(table).select('id').eq('workspace_id', ws).in('id', ids) : { data: [] };
    out[key] = (data || []).map((r: any) => r.id);
  }
  return out;
}

async function freeSlug(db: any, ws: string, want: string, self?: string) {
  let s = want, n = 1;
  for (;;) {
    const { data } = await db.from('portals').select('id').eq('workspace_id', ws).eq('slug', s).maybeSingle();
    if (!data || data.id === self) return s;
    n++; s = `${want.slice(0, 36)}-${n}`;
  }
}

export async function POST(request: Request) {
  const b = await request.json().catch(() => ({}));
  const ws = uuid(b?.workspace_id);
  if (!ws) return Response.json({ error: 'Workspace not found.' }, { status: 404 });
  const m = await member(ws);
  if (m.error) return m.error;
  const db = createAdminClient();
  const f = await fields(db, ws, { name: b.name || 'Brand portal', slug: b.slug || b.name || 'brand', ...b });
  if (f.access === 'passcode' && !f.passcode_hash) return Response.json({ error: 'Set a passcode, or choose another kind of access.' }, { status: 400 });
  f.slug = await freeSlug(db, ws, f.slug);
  const { data, error } = await db.from('portals').insert({ workspace_id: ws, created_by: m.user.id, ...f }).select('*').single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  const { passcode_hash, ...portal } = data;
  return Response.json({ portal: { ...portal, has_passcode: !!passcode_hash }, ws_slug: m.ws.slug });
}

export async function PATCH(request: Request) {
  const b = await request.json().catch(() => ({}));
  const id = uuid(b?.id);
  const db = createAdminClient();
  const { data: p } = id ? await db.from('portals').select('id, workspace_id, passcode_hash, access').eq('id', id).maybeSingle() : { data: null };
  if (!p) return Response.json({ error: 'Portal not found.' }, { status: 404 });
  const m = await member(p.workspace_id);
  if (m.error) return m.error;
  const f = await fields(db, p.workspace_id, b);
  if ((f.access || p.access) === 'passcode' && !('passcode_hash' in f ? f.passcode_hash : p.passcode_hash)) return Response.json({ error: 'Set a passcode, or choose another kind of access.' }, { status: 400 });
  if (f.slug) f.slug = await freeSlug(db, p.workspace_id, f.slug, p.id);
  const { data, error } = await db.from('portals').update(f).eq('id', p.id).select('*').single();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  const { passcode_hash, ...portal } = data;
  return Response.json({ portal: { ...portal, has_passcode: !!passcode_hash } });
}
