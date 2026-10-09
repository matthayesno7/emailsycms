// Integrations: other tools (Bloomreach, a CMS, an email builder) embed the Mise picker with an
// integration key and get permanent links to approved assets. Server only.
import { createHash, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from './supabase/admin';
import { planOf } from './billing';
import { isAvailable } from './lifecycle';
import { appUrl } from './keys';

// ---------- keys ----------
export const hashPickerKey = (key: string) => createHash('sha256').update(key).digest('hex');
export function newPickerKey() {
  const key = 'mpk_' + randomBytes(24).toString('base64url');
  return { key, prefix: key.slice(0, 12), hash: hashPickerKey(key) };
}
export const looksLikeKey = (k: unknown): k is string => typeof k === 'string' && /^mpk_[A-Za-z0-9_-]{32}$/.test(k);

export { normaliseSite, originAllowed } from './sites';

// The key behind a picker request, if it's live and the brand is on Pro or Enterprise.
export type PickerCtx = { db: SupabaseClient; key: { id: string; name: string; origins: string[] }; ws: { id: string; name: string; slug: string } };
export async function loadPicker(key: unknown): Promise<PickerCtx | { error: 'key' | 'plan' }> {
  if (!looksLikeKey(key)) return { error: 'key' };
  const db = createAdminClient();
  const { data: k } = await db.from('integration_keys').select('id, name, origins, workspace_id, revoked_at').eq('key_hash', hashPickerKey(key)).maybeSingle();
  if (!k || k.revoked_at) return { error: 'key' };
  if ((await planOf(db, k.workspace_id)).plan === 'free') return { error: 'plan' };
  const { data: ws } = await db.from('workspaces').select('id, name, slug').eq('id', k.workspace_id).maybeSingle();
  if (!ws) return { error: 'key' };
  return { db, key: { id: k.id, name: k.name, origins: k.origins || [] }, ws };
}

// A few hundred picker requests a minute per key, per server process.
const hits = new Map<string, { n: number; at: number }>();
export function tooBusy(id: string, max = 300) {
  const now = Date.now(), h = hits.get(id);
  if (!h || now - h.at > 60_000) { hits.set(id, { n: 1, at: now }); return false; }
  return ++h.n > max;
}

// ---------- which assets ----------
export const PICK_KINDS = ['image', 'logo', 'product', 'video'] as const;
export const PICK_COLS = 'id, workspace_id, kind, name, storage_path, mime, width, height, bytes, images, fields, description, tags, pid, price, link, status, lifecycle, licence_expires_at, public_token, created_at';
// Only approved, available files with a stored file: never drafts, blocks or anything retired.
export const pickable = (a: any) => !!a && a.status !== 'draft' && a.kind !== 'block' && !!a.storage_path && isAvailable(a);

// ---------- permanent links ----------
const slug = (s: string) => (s || 'file').normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60) || 'file';
const extOf = (p: string) => (p.split('.').pop() || 'jpg').toLowerCase();

// Make sure each asset has its permanent-link token (made the first time it's needed).
export async function withTokens(db: SupabaseClient, rows: any[]) {
  for (const a of rows.filter((r) => !r.public_token)) {
    const t = randomBytes(16).toString('base64url');
    await db.from('assets').update({ public_token: t }).eq('id', a.id).is('public_token', null);
    const { data } = await db.from('assets').select('public_token').eq('id', a.id).maybeSingle();
    a.public_token = data?.public_token || null;
  }
  return rows;
}

// app.misedam.com/a/<token>/<name>.<ext>: the current version, for as long as the asset is available.
export function permanentUrl(a: any, opts: { email?: boolean; width?: number } = {}) {
  const ext = extOf(opts.email && a.images?.email?.path ? a.images.email.path : a.storage_path);
  const q = opts.email ? '?f=email' : opts.width ? `?w=${opts.width}` : '';
  return `${appUrl()}/a/${a.public_token}/${slug(a.pid || a.name)}.${ext}${q}`;
}

// What a tool receives for each picked asset. Everything here is safe to store in another system.
export function pickedAsset(a: any, brand: string) {
  const resizable = /^image\/(png|jpeg|webp)$/.test(a.mime || '');
  return {
    id: a.id,
    name: a.name,
    type: a.kind,
    mime: a.mime || null,
    width: a.width || null,
    height: a.height || null,
    bytes: a.bytes || null,
    alt: a.fields?.alt || a.description || a.name,
    description: a.description || '',
    tags: a.tags || [],
    url: permanentUrl(a),
    email_url: a.images?.email?.path ? permanentUrl(a, { email: true }) : null,
    thumbnail_url: resizable ? permanentUrl(a, { width: 400 }) : a.images?.email?.path ? permanentUrl(a, { email: true }) : permanentUrl(a),
    product: a.kind === 'product' ? { id: a.pid || null, title: a.fields?.name || a.name, price: a.fields?.price || a.price || null, link: a.fields?.link || a.link || null, label: a.fields?.label || null, button: a.fields?.button || null } : null,
    brand,
  };
}
export type PickedAsset = ReturnType<typeof pickedAsset>;
