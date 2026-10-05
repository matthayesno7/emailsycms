// Share links and brand portals: the server side of public pages.
// Public visitors never touch the database directly. Every page and file goes through here:
// find the link or portal, check it's live and the visitor may see it, then work out exactly
// which assets it shares. Uses the service-role client, so everything is scoped by hand.
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { isAvailable } from './lifecycle';
import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from './supabase/admin';
import { matchesRules, type Rules } from './collections';
import { collectionHits } from './search';
import type { BrandKit } from './brandKit';

export const FORMATS = ['original', 'web', 'email'] as const;
export type Format = (typeof FORMATS)[number];
export const FORMAT_LABEL: Record<Format, string> = { original: 'Original', web: 'Web (2000px)', email: 'Email-ready (1200px)' };

// ---------- secrets ----------
export const newToken = () => randomBytes(18).toString('base64url'); // 144 bits

export function hashPasscode(p: string) {
  const salt = randomBytes(12).toString('base64url');
  return `s1$${salt}$${scryptSync(p, salt, 32).toString('base64url')}`;
}
export function checkPasscode(p: string, stored: string | null) {
  if (!stored) return true;
  const [, salt, hash] = stored.split('$');
  if (!salt || !hash) return false;
  const a = scryptSync(p, salt, 32), b = Buffer.from(hash, 'base64url');
  return a.length === b.length && timingSafeEqual(a, b);
}

const secret = () => process.env.SHARE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'dev-only';
// The unlock cookie proves the visitor typed the passcode. It names the passcode it was made for,
// so changing the passcode locks everyone out again.
const cookieName = (kind: 's' | 'p', id: string) => `mise_${kind}_${id.replace(/-/g, '').slice(0, 16)}`;
const sign = (kind: string, id: string, passHash: string) => createHmac('sha256', secret()).update(`${kind}:${id}:${passHash}`).digest('base64url');

export async function isUnlocked(kind: 's' | 'p', id: string, passHash: string | null) {
  if (!passHash) return true;
  const c = (await cookies()).get(cookieName(kind, id))?.value || '';
  const want = sign(kind, id, passHash);
  return c.length === want.length && timingSafeEqual(Buffer.from(c), Buffer.from(want));
}
export async function setUnlocked(kind: 's' | 'p', id: string, passHash: string, path: string) {
  (await cookies()).set(cookieName(kind, id), sign(kind, id, passHash), { httpOnly: true, secure: true, sameSite: 'lax', path, maxAge: 60 * 60 * 24 * 30 });
}

// A handful of wrong passcodes per minute per link, per server process.
const attempts = new Map<string, { n: number; at: number }>();
export function tooManyAttempts(key: string) {
  const now = Date.now(), a = attempts.get(key);
  if (!a || now - a.at > 60_000) { attempts.set(key, { n: 1, at: now }); return false; }
  a.n++;
  return a.n > 8;
}

// ---------- loading links and portals ----------
export type ShareRow = Record<string, any> & { id: string; workspace_id: string; kind: string; passcode_hash: string | null; expires_at: string | null; revoked_at: string | null; allow_download: boolean; formats: string[] };
export type PortalRow = Record<string, any> & { id: string; workspace_id: string; slug: string; access: string; passcode_hash: string | null; allowlist: string[]; published: boolean; allow_download: boolean; formats: string[] };
export type Brand = { id: string; name: string; slug: string; kit: BrandKit | null };

export async function loadShare(token: string) {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(token)) return null;
  const db = createAdminClient();
  const { data } = await db.from('shares').select('*').eq('token', token).maybeSingle();
  return data ? { db, share: data as ShareRow } : null;
}
export const shareState = (s: ShareRow) => (s.revoked_at ? 'revoked' : s.expires_at && new Date(s.expires_at) < new Date() ? 'expired' : 'live');

export async function loadPortal(wsSlug: string, portalSlug: string) {
  const db = createAdminClient();
  const { data: ws } = await db.from('workspaces').select('id, name, slug').eq('slug', wsSlug.toLowerCase()).maybeSingle();
  if (!ws) return null;
  const { data: portal } = await db.from('portals').select('*').eq('workspace_id', ws.id).eq('slug', portalSlug.toLowerCase()).maybeSingle();
  if (!portal) return null;
  return { db, ws, portal: portal as PortalRow };
}
export async function loadPortalById(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = createAdminClient();
  const { data: portal } = await db.from('portals').select('*').eq('id', id).maybeSingle();
  if (!portal) return null;
  const { data: ws } = await db.from('workspaces').select('id, name, slug').eq('id', portal.workspace_id).maybeSingle();
  return ws ? { db, ws, portal: portal as PortalRow } : null;
}

export async function kitLogoIds(db: SupabaseClient, ws: string): Promise<string[]> {
  const { data } = await db.from('brand_kits').select('kit').eq('workspace_id', ws).maybeSingle();
  const l = (data?.kit as BrandKit | undefined)?.logos;
  return [l?.primary, l?.reversed, l?.icon].filter((x): x is string => !!x);
}

export async function brandOf(db: SupabaseClient, ws: { id: string; name: string; slug: string }): Promise<Brand> {
  const { data } = await db.from('brand_kits').select('kit').eq('workspace_id', ws.id).maybeSingle();
  return { ...ws, kit: (data?.kit as BrandKit) || null };
}

// Signed-in visitor allowed by an allowlist portal? Entries are emails or "@domain.com".
export function allowed(list: string[], email?: string | null) {
  const e = (email || '').toLowerCase().trim();
  if (!e) return false;
  return list.some((x) => { const v = x.toLowerCase().trim(); return v.startsWith('@') ? e.endsWith(v) : v === e; });
}

// Who's looking: a signed-in visitor's email, and whether they're on the brand's team
// (team members can always preview their own portals and links).
export async function visitor(db: SupabaseClient, workspaceId: string) {
  const { createClient } = await import('./supabase/server');
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (!user) return { email: null as string | null, member: false };
  const { data } = await db.from('workspace_members').select('user_id').eq('workspace_id', workspaceId).eq('user_id', user.id).maybeSingle();
  return { email: (user.email || '').toLowerCase() || null, member: !!data };
}

// Can this visitor see the portal right now? 'ok', or what they need to do first.
export async function portalAccess(portal: PortalRow, visitorEmail: string | null, member = false): Promise<'ok' | 'passcode' | 'signin' | 'denied' | 'unpublished'> {
  if (member) return 'ok';
  if (!portal.published) return 'unpublished';
  if (portal.access === 'passcode') return (await isUnlocked('p', portal.id, portal.passcode_hash)) ? 'ok' : 'passcode';
  if (portal.access === 'allowlist') return !visitorEmail ? 'signin' : allowed(portal.allowlist, visitorEmail) ? 'ok' : 'denied';
  return 'ok';
}

// ---------- what a link or portal shares ----------
const COLS = 'id, workspace_id, kind, name, storage_path, mime, width, height, bytes, images, fields, folder_id, description, tags, colour_names, text_in_image, on_brand, origin, status, pid, created_at, lifecycle, licence_expires_at';
// Drafts, blocks and anything no longer available (archived, licence expired, obsolete) are never public.
const publicAsset = (a: any) => a.status !== 'draft' && a.kind !== 'block' && !!a.storage_path && isAvailable(a);

// gone: how many files in the link are no longer available (shown as a note, never as files).
export async function shareAssets(db: SupabaseClient, s: ShareRow): Promise<any[] & { gone: number }> {
  let rows: any[] = [];
  if (s.kind === 'assets' && s.asset_ids?.length) {
    const { data } = await db.from('assets').select(COLS).eq('workspace_id', s.workspace_id).in('id', s.asset_ids);
    const order = new Map<string, number>(s.asset_ids.map((id: string, i: number) => [id, i] as [string, number]));
    rows = (data || []).sort((a: any, b: any) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  } else if (s.kind === 'folder' && s.folder_id) {
    const { data } = await db.from('assets').select(COLS).eq('workspace_id', s.workspace_id).eq('folder_id', s.folder_id).order('created_at', { ascending: false }).limit(2000);
    rows = data || [];
  } else if (s.kind === 'collection' && s.collection_id) {
    const { data: c } = await db.from('collections').select('rules').eq('id', s.collection_id).eq('workspace_id', s.workspace_id).maybeSingle();
    if (c) { const hits = await collectionHits(db, s.workspace_id, c.rules as Rules); rows = (await allWorkspaceAssets(db, s.workspace_id)).filter((a) => matchesRules(a, c.rules as Rules, hits)); }
  }
  // A link to hand-picked files may include drafts the sender chose; folders and collections never do.
  const shareable = rows.filter((a) => a.kind !== 'block' && a.storage_path && (s.kind === 'assets' || a.status !== 'draft'));
  const live = shareable.filter((a) => isAvailable(a));
  return Object.assign(live, { gone: shareable.length - live.length });
}

async function allWorkspaceAssets(db: SupabaseClient, ws: string) {
  const { data } = await db.from('assets').select(COLS).eq('workspace_id', ws).neq('kind', 'block').order('created_at', { ascending: false }).limit(5000);
  return data || [];
}

export type Section = { id: string; name: string; asset_ids: string[] };
// The portal's files, grouped into the sections visitors browse (one per folder or collection).
export async function portalContents(db: SupabaseClient, p: PortalRow): Promise<{ assets: any[]; sections: Section[] }> {
  const all = (await allWorkspaceAssets(db, p.workspace_id)).filter(publicAsset);
  const sections: Section[] = [];
  const [{ data: folders }, { data: colls }] = await Promise.all([
    db.from('folders').select('id, name').eq('workspace_id', p.workspace_id).order('name'),
    db.from('collections').select('id, name, rules').eq('workspace_id', p.workspace_id).order('position'),
  ]);
  const wantFolders = p.include_all ? (folders || []) : (folders || []).filter((f: any) => p.folder_ids.includes(f.id));
  for (const f of wantFolders) {
    const ids = all.filter((a: any) => a.folder_id === f.id).map((a: any) => a.id);
    if (ids.length) sections.push({ id: `f:${f.id}`, name: f.name, asset_ids: ids });
  }
  for (const c of (colls || []).filter((c: any) => p.collection_ids.includes(c.id))) {
    const hits = await collectionHits(db, p.workspace_id, c.rules as Rules);
    const ids = all.filter((a: any) => matchesRules(a, c.rules as Rules, hits)).map((a: any) => a.id);
    if (ids.length) sections.push({ id: `c:${c.id}`, name: c.name, asset_ids: ids });
  }
  const inSections = new Set(sections.flatMap((s) => s.asset_ids));
  if (p.include_all) {
    const logos = all.filter((a: any) => a.kind === 'logo').map((a: any) => a.id);
    if (logos.length && !sections.some((s) => s.name.toLowerCase().includes('logo'))) sections.unshift({ id: 'logos', name: 'Logos', asset_ids: logos });
    const rest = all.filter((a: any) => !inSections.has(a.id) && a.kind !== 'logo').map((a: any) => a.id);
    if (rest.length) sections.push({ id: 'more', name: sections.some((s) => s.id !== 'logos') ? 'More' : sections.length ? 'Images' : 'Everything', asset_ids: rest });
  }
  const shown = new Set(sections.flatMap((s) => s.asset_ids));
  return { assets: all.filter((a: any) => shown.has(a.id)), sections };
}

// ---------- files ----------
// Thumbnails for the page: the email-ready copy (small) when there is one. Signed for an hour.
export async function thumbUrls(db: SupabaseClient, assets: any[]) {
  const paths = [...new Set(assets.map((a) => a.images?.email?.path || a.storage_path).filter(Boolean))] as string[];
  const out: Record<string, string> = {};
  for (let i = 0; i < paths.length; i += 500) {
    const { data } = await db.storage.from('assets').createSignedUrls(paths.slice(i, i + 500), 3600);
    for (const d of data || []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
  }
  return Object.fromEntries(assets.map((a) => [a.id, out[a.images?.email?.path || a.storage_path] || '']));
}

// A short-lived download link for one format.
export async function fileUrl(db: SupabaseClient, a: any, format: Format, download: boolean) {
  const ext = (p: string) => p.split('.').pop() || 'jpg';
  const base = (a.pid || a.name || 'file').replace(/[^\w.-]+/g, '-').toLowerCase();
  const isImage = /^image\/(png|jpeg|webp)$/.test(a.mime || '');
  if (format === 'email' && a.images?.email?.path) {
    const p = a.images.email.path;
    return (await db.storage.from('assets').createSignedUrl(p, 120, download ? { download: `${base}-email.${ext(p)}` } : undefined)).data?.signedUrl || null;
  }
  if (format === 'web' && isImage && (a.width || 0) > 2000) {
    // Resized on the fly when Supabase image transformations are on; otherwise the email-ready copy.
    const t = await db.storage.from('assets').createSignedUrl(a.storage_path, 120, { transform: { width: 2000, resize: 'contain' }, ...(download ? { download: `${base}-web.${ext(a.storage_path)}` } : {}) });
    if (t.data?.signedUrl) return t.data.signedUrl;
    if (a.images?.email?.path) return fileUrl(db, a, 'email', download);
  }
  return (await db.storage.from('assets').createSignedUrl(a.storage_path, 120, download ? { download: `${base}.${ext(a.storage_path)}` } : undefined)).data?.signedUrl || null;
}

export async function logEvent(db: SupabaseClient, e: { workspace_id: string; share_id?: string; portal_id?: string; asset_id?: string; event: 'view' | 'download'; email?: string | null; format?: string }) {
  await db.from('share_events').insert({ ...e, email: e.email || null });
  if (e.share_id) await db.rpc('bump_share', { p_share: e.share_id, p_view: e.event === 'view' ? 1 : 0, p_download: e.event === 'download' ? 1 : 0 });
}

// For the public API routes: a link (s=token) or portal (p=id) the visitor may open right now,
// with the assets it shares. null when it doesn't exist, isn't live, or is locked for them.
export async function publicContext(ref: { s?: string | null; p?: string | null }) {
  if (ref.s) {
    const r = await loadShare(ref.s);
    if (!r) return null;
    const v = await visitor(r.db, r.share.workspace_id);
    if (!v.member && (shareState(r.share) !== 'live' || !(await isUnlocked('s', r.share.id, r.share.passcode_hash)))) return null;
    const assets = await shareAssets(r.db, r.share);
    return { db: r.db, workspace_id: r.share.workspace_id, share_id: r.share.id, portal_id: undefined as string | undefined, email: null as string | null, member: v.member, assets, allow_download: r.share.allow_download, formats: r.share.formats as Format[] };
  }
  if (ref.p) {
    const r = await loadPortalById(ref.p);
    if (!r) return null;
    const v = await visitor(r.db, r.portal.workspace_id);
    if ((await portalAccess(r.portal, v.email, v.member)) !== 'ok') return null;
    const { assets } = await portalContents(r.db, r.portal);
    // The guidelines page offers the brand kit's logos for download too.
    if (r.portal.show_guidelines) {
      const ids = await kitLogoIds(r.db, r.portal.workspace_id);
      const missing = ids.filter((id) => !assets.some((a) => a.id === id));
      if (missing.length) {
        const { data } = await r.db.from('assets').select(COLS).eq('workspace_id', r.portal.workspace_id).in('id', missing);
        assets.push(...(data || []).filter((a: any) => a.storage_path && isAvailable(a)));
      }
    }
    return { db: r.db, workspace_id: r.portal.workspace_id, share_id: undefined as string | undefined, portal_id: r.portal.id, email: r.portal.access === 'allowlist' ? v.email : null, member: v.member, assets, allow_download: r.portal.allow_download, formats: r.portal.formats as Format[] };
  }
  return null;
}

// What a visitor's browser gets for each asset: no storage paths, no internal fields.
export function publicView(a: any, thumb: string) {
  return {
    id: a.id, kind: a.kind, name: a.name, width: a.width, height: a.height, mime: a.mime, bytes: a.bytes,
    thumb, alt: a.fields?.alt || a.description || a.name, description: a.description || '',
    has_email: !!a.images?.email?.path, email_w: a.images?.email?.width || null, pid: a.pid || null,
  };
}
export type PublicAsset = ReturnType<typeof publicView>;
