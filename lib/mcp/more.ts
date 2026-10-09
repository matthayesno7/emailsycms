// The connector's working tools: review, organise, edit, versions, sharing, importing and setup.
// With these, a team can run Mise from Claude without opening the app. Every call checks the
// user's workspaces first (the database client is the service role); anything that leaves the
// building (share links, portals) or can't be undone (deleting) is described so Claude asks first.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AssetRow, Ctx, Workspace } from './server';
import { publicAsset } from './server';
import { reviewQueue, summaryLine, SECTION } from '../review';
import { describeRules, matchesRules, type Rules } from '../collections';
import { collectionHits, searchAssets } from '../search';
import { editImage, emailCopy, describeEdit, sizePresets, type ServerEdit } from '../serverImage';
import { FORMATS as SHARE_FORMATS, hashPasscode, newToken, shareState } from '../share';
import { brandKitFromWebsite } from '../brandFromSite';
import { fetchLimited, IMAGE_EXT } from '../net';
import { imageSize } from '../imageSize';
import { lifecyclePatch } from '../lifecycle';
import { MAX_IMAGE_BYTES, MAX_IMPORT_BYTES } from '../plans';
import { planOf } from '../billing';
import { uploadEmailCopy } from '../uploadEmailCopy';

export type MoreCtx = Ctx & { db?: SupabaseClient; appUrl?: string };

const text = (data: unknown) => ({ content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] });
const toolError = (message: string) => ({ content: [{ type: 'text', text: message }], isError: true });
const uuid = (v: unknown) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null);
const ids = (v: unknown, max = 200) => [...new Set((Array.isArray(v) ? v : typeof v === 'string' ? [v] : []).map(uuid).filter(Boolean) as string[])].slice(0, max);
const ws = { type: 'string', description: 'Workspace (brand) id from list_workspaces.' };
const idList = (d: string) => ({ type: 'array', items: { type: 'string' }, description: d });

export const MORE_TOOLS = [
  // ---------- review ----------
  {
    name: 'get_review_queue',
    description: 'What needs a person in Mise: drafts waiting for approval (made with Claude or Create), possible duplicates, off-brand files, files Mise couldn’t organise, products without a photo and an unapproved brand kit, plus what Mise did this week. Call it when the user asks what needs them, for a morning check-in, or before tidying up. Omit workspace_id for every brand.',
    inputSchema: { type: 'object', properties: { workspace_id: ws }, additionalProperties: false },
  },
  {
    name: 'approve_assets',
    description: 'Approve draft assets so the team can use them (they show in portals and count as approved). Only when the user says so: approving is a person’s call.',
    inputSchema: { type: 'object', properties: { asset_ids: idList('Draft asset ids.') }, required: ['asset_ids'], additionalProperties: false },
  },
  {
    name: 'delete_assets',
    description: 'Delete assets for good, with every version and file (rejecting drafts, removing duplicates). This can’t be undone: list what you will delete and get a clear yes first, unless the user already named exactly these.',
    inputSchema: { type: 'object', properties: { asset_ids: idList('Asset ids to delete.') }, required: ['asset_ids'], additionalProperties: false },
  },
  {
    name: 'resolve_review_item',
    description: 'Settle a review item without deleting anything: keep_both (it isn’t a duplicate), on_brand (a person checked it and it’s fine; auto-organise won’t flag it again) or retry (organise a file again that failed).',
    inputSchema: { type: 'object', properties: { asset_id: { type: 'string' }, action: { type: 'string', enum: ['keep_both', 'on_brand', 'retry'] } }, required: ['asset_id', 'action'], additionalProperties: false },
  },
  // ---------- organise ----------
  {
    name: 'update_asset',
    description: 'Change an asset’s details: name, alt text, description, tags (replace, add or remove), folder (by id or name; a new name makes the folder), type (image or logo) or focal point. Changes a person makes are kept: auto-organise won’t overwrite them.',
    inputSchema: {
      type: 'object',
      properties: {
        asset_id: { type: 'string' },
        name: { type: 'string' }, alt: { type: 'string' }, description: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Replace all tags.' },
        add_tags: { type: 'array', items: { type: 'string' } }, remove_tags: { type: 'array', items: { type: 'string' } },
        folder_id: { type: ['string', 'null'], description: 'Folder id, or null to take it out of its folder.' },
        folder: { type: 'string', description: 'Folder name; made if it doesn’t exist.' },
        kind: { type: 'string', enum: ['image', 'logo'] },
        focus: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, description: 'Focal point, 0..1 from the top left: crops keep it in view.' },
        availability: { type: 'string', enum: ['available', 'archived', 'obsolete'], description: 'Retire a file: archived (no longer used) or obsolete (superseded, e.g. an old logo; Pro). available brings it back. Unavailable files stay in Mise, marked, but are kept out of new work, links and portals.' },
        availability_reason: { type: 'string', description: 'Why, in a few words, e.g. "Replaced by the 2026 logo".' },
        replaced_by: { type: ['string', 'null'], description: 'For an obsolete file: the asset id people should use instead (Pro).' },
        licence_expires_at: { type: ['string', 'null'], description: 'ISO date the licence or usage rights end (Pro). On that date the file is blocked automatically. null removes it.' },
      },
      required: ['asset_id'], additionalProperties: false,
    },
  },
  {
    name: 'move_to_folder',
    description: 'Put several assets in one folder (by id or name; a new name makes the folder). folder null takes them out of their folders.',
    inputSchema: { type: 'object', properties: { asset_ids: idList('Asset ids.'), folder_id: { type: ['string', 'null'] }, folder: { type: 'string' }, workspace_id: ws }, required: ['asset_ids'], additionalProperties: false },
  },
  {
    name: 'list_folders',
    description: 'The workspace’s folders and smart collections (saved searches that fill themselves), with how many files each holds.',
    inputSchema: { type: 'object', properties: { workspace_id: ws }, required: ['workspace_id'], additionalProperties: false },
  },
  {
    name: 'create_collection',
    description: 'Make a smart collection: a saved search that fills itself as files arrive. describe is matched by meaning (e.g. "lifestyle shots for email"); tags, kinds and on_brand narrow it. Returns how many files match now.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: ws, name: { type: 'string' }, describe: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } }, match: { type: 'string', enum: ['any', 'all'] },
        kinds: { type: 'array', items: { type: 'string', enum: ['image', 'logo', 'product', 'video'] } },
        on_brand: { type: 'boolean' },
      },
      required: ['workspace_id', 'name'], additionalProperties: false,
    },
  },
  {
    name: 'delete_folder_or_collection',
    description: 'Delete a folder (its files stay, just unfiled) or a smart collection (nothing else changes). Share links to it stop working.',
    inputSchema: { type: 'object', properties: { folder_id: { type: 'string' }, collection_id: { type: 'string' } }, additionalProperties: false },
  },
  // ---------- edit ----------
  {
    name: 'edit_image',
    description: 'Crop, resize, rotate, flip or brighten an uploaded photo, logo or product photo, on the server. Use a named size (preset) or width and height; crops keep the focal point in view. Saves a new version (the old one is kept) or a copy. Not for designs made in Create (they’re edited in Mise’s Create editor) or in Figma (edit the frame in Figma and save it back with add_generated_asset and replaces_asset_id).',
    inputSchema: {
      type: 'object',
      properties: {
        asset_id: { type: 'string' },
        preset: { type: 'string', description: 'Named size: email-full, email-two-column, email-mobile-hero, linkedin-banner, linkedin-post, ig-post, story, square, marketplace-square, shopify-product, product-portrait, or team:<name> for the team’s own sizes.' },
        width: { type: 'number' }, height: { type: 'number' },
        ratio: { type: 'string', description: 'Crop to a shape without resizing, e.g. "1:1", "4:5", "16:9".' },
        crop: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } }, description: 'Exact crop box, 0..1 of the picture.' },
        rotate: { type: 'number', enum: [0, 90, 180, 270] }, flip: { type: 'boolean' },
        brightness: { type: 'number', description: '-100..100' }, saturation: { type: 'number', description: '-100..100' },
        save_as: { type: 'string', enum: ['version', 'copy'], default: 'version', description: 'version replaces the current file (kept in the history); copy makes a new asset, e.g. a LinkedIn crop beside the original.' },
        name: { type: 'string', description: 'Name for a copy.' },
      },
      required: ['asset_id'], additionalProperties: false,
    },
  },
  {
    name: 'list_versions',
    description: 'An asset’s version history: each earlier file with its note and date.',
    inputSchema: { type: 'object', properties: { asset_id: { type: 'string' } }, required: ['asset_id'], additionalProperties: false },
  },
  {
    name: 'revert_asset',
    description: 'Bring back an earlier version as the current one (the current one is kept in the history too).',
    inputSchema: { type: 'object', properties: { asset_id: { type: 'string' }, version: { type: 'number' } }, required: ['asset_id', 'version'], additionalProperties: false },
  },
  // ---------- share ----------
  {
    name: 'create_share_link',
    description: 'Make a share link anyone with it can open, styled with the brand kit: chosen files, a folder or a smart collection (folders and collections keep filling). Optional passcode, expiry and downloads. It goes outside the team: confirm what’s in it with the user first. Returns the link.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: ws, title: { type: 'string' }, message: { type: 'string' },
        asset_ids: idList('Files to share.'), folder_id: { type: 'string' }, collection_id: { type: 'string' },
        expires_in_days: { type: 'number' }, expires_at: { type: 'string', description: 'ISO date.' },
        passcode: { type: 'string' }, allow_download: { type: 'boolean', default: true },
        formats: { type: 'array', items: { type: 'string', enum: [...SHARE_FORMATS] }, description: 'Download sizes offered: original, web (2000px), email (1200px).' },
      },
      required: ['workspace_id'], additionalProperties: false,
    },
  },
  {
    name: 'list_share_links',
    description: 'The workspace’s share links with what they hold, views, downloads and whether they’re live, expired or revoked.',
    inputSchema: { type: 'object', properties: { workspace_id: ws }, required: ['workspace_id'], additionalProperties: false },
  },
  {
    name: 'update_share_link',
    description: 'Change or stop a share link: revoke (stops it working), restore, new expiry, passcode (empty string removes it), downloads on or off.',
    inputSchema: { type: 'object', properties: { share_id: { type: 'string' }, revoke: { type: 'boolean' }, restore: { type: 'boolean' }, expires_in_days: { type: 'number' }, expires_at: { type: ['string', 'null'] }, passcode: { type: 'string' }, allow_download: { type: 'boolean' }, title: { type: 'string' } }, required: ['share_id'], additionalProperties: false },
  },
  {
    name: 'list_portals',
    description: 'The workspace’s brand portals (a public library of approved files with brand guidelines), with their addresses and settings.',
    inputSchema: { type: 'object', properties: { workspace_id: ws }, required: ['workspace_id'], additionalProperties: false },
  },
  {
    name: 'save_portal',
    description: 'Create a brand portal (omit portal_id) or change one: name, intro, what’s in it (include_all approved files, or chosen folder_ids and collection_ids), access (public, passcode or allowlist of emails or @domains), downloads and whether it’s published. It’s public-facing: confirm changes with the user first.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: ws, portal_id: { type: 'string' }, name: { type: 'string' }, intro: { type: 'string' },
        include_all: { type: 'boolean' }, folder_ids: idList('Folders shown as sections.'), collection_ids: idList('Smart collections shown as sections.'),
        access: { type: 'string', enum: ['public', 'passcode', 'allowlist'] }, passcode: { type: 'string' }, allowlist: { type: 'array', items: { type: 'string' } },
        allow_download: { type: 'boolean' }, published: { type: 'boolean' }, show_guidelines: { type: 'boolean' },
      },
      required: ['workspace_id'], additionalProperties: false,
    },
  },
  // ---------- bring things in ----------
  {
    name: 'import_from_urls',
    description: 'Add images or videos to a workspace from https links (up to 25 at a time), e.g. files the user pasted or a site’s product photos. They’re organised automatically (tags, alt text, brand check). Optional folder. For files on the user’s computer, give them get_upload_link instead.',
    inputSchema: {
      type: 'object',
      properties: { workspace_id: ws, urls: { type: 'array', items: { type: 'string' } }, folder: { type: 'string', description: 'Folder name; made if needed.' }, kind: { type: 'string', enum: ['image', 'logo'] } },
      required: ['workspace_id', 'urls'], additionalProperties: false,
    },
  },
  {
    name: 'get_upload_link',
    description: 'A link to the brand’s library in Mise where the user can drop files or whole folders from their computer (Claude can’t pass files from the chat to Mise).',
    inputSchema: { type: 'object', properties: { workspace_id: ws }, required: ['workspace_id'], additionalProperties: false },
  },
  // ---------- set up ----------
  {
    name: 'create_brand',
    description: 'Make a new brand workspace, owned by the user. One free brand per person; further brands start at checkout in Mise, except on an Enterprise account, where they join the account straight away. Pass website to build its brand kit from the site straight away (saved as a draft to approve).',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, website: { type: 'string' } }, required: ['name'], additionalProperties: false },
  },
  {
    name: 'brand_kit_from_website',
    description: 'Build or refresh a workspace’s brand kit from its website: colours, fonts, button style, logo and a reference photo. Saved as a draft for the team to approve.',
    inputSchema: { type: 'object', properties: { workspace_id: ws, url: { type: 'string' } }, required: ['workspace_id', 'url'], additionalProperties: false },
  },
  {
    name: 'approve_brand_kit',
    description: 'Approve the workspace’s draft brand kit (owners only). Only when the user has looked at it and says so.',
    inputSchema: { type: 'object', properties: { workspace_id: ws }, required: ['workspace_id'], additionalProperties: false },
  },
  {
    name: 'invite_teammate',
    description: 'Invite someone to a workspace by email, with a role (admins and owners only). New people get an email; people with an account see the brand next time they open Mise.',
    inputSchema: { type: 'object', properties: { workspace_id: ws, email: { type: 'string' }, role: { type: 'string', enum: ['admin', 'editor', 'contributor', 'viewer'], default: 'editor', description: 'admin: people and settings; editor: add, edit, approve, share; contributor: add and make things that wait for review; viewer: look and download.' } }, required: ['workspace_id', 'email'], additionalProperties: false },
  },
];

export const MORE_INSTRUCTIONS = `Running Mise from Claude (people don't need to open the app):
- Review: get_review_queue shows what needs a person. Show it simply (drafts first) and let the user decide: approve_assets, delete_assets (always confirm first), resolve_review_item. Approving, deleting and anything public is the user's call, never yours alone.
- Organise: update_asset, move_to_folder, list_folders, create_collection. Find files with list_assets (query is matched by meaning; since, folder_id and collection_id narrow it).
- Edit: edit_image for uploaded photos and product photos (crop to a named size, resize, rotate). Designs made in Create are edited in Mise's Create editor (give the user the asset's Mise link); designs made in Figma are edited in Figma and saved back with add_generated_asset and replaces_asset_id. list_versions and revert_asset undo changes.
- Share: create_share_link, update_share_link, list_share_links, list_portals, save_portal. Confirm what goes out before creating or publishing, then give the user the link.
- Bring things in: import_from_urls for links; get_upload_link for files on the user's computer.
- Set up: create_brand, brand_kit_from_website, approve_brand_kit (only when the user approves), invite_teammate.
- Regular jobs ("every Monday…", "when new products arrive…") run as a scheduled task in Claude that uses these tools, e.g. list_assets with since for what's new, then get_review_queue.`;

// ---------- helpers ----------
function need(ctx: MoreCtx) {
  if (!ctx.db) throw new Error('This Mise server can’t do that yet.');
  return ctx.db;
}
async function workspace(ctx: MoreCtx, id: unknown): Promise<{ ws: Workspace } | { error: string }> {
  const list = await ctx.repo.workspacesForUser(ctx.userId);
  const w = list.find((x) => x.id === id);
  return w ? { ws: w } : { error: 'That workspace is not one of yours. Call list_workspaces for valid ids.' };
}
// Assets the user may touch, all from one workspace.
// Free is a taster: sharing and editing are on Pro. null when allowed.
async function proOnly(ctx: MoreCtx, ws: string, what: 'share' | 'edit') {
  if (!ctx.db || (await planOf(ctx.db, ws)).plan !== 'free') return null;
  return what === 'share'
    ? 'Sharing (links and portals) is on Pro. The brand’s owner can upgrade in Mise → Settings → Plan & usage.'
    : 'Editing files is on Pro. The brand’s owner can upgrade in Mise → Settings → Plan & usage.';
}

async function ownAssets(ctx: MoreCtx, want: string[]): Promise<{ rows: AssetRow[]; ws: Workspace } | { error: string }> {
  if (!want.length) return { error: 'Pass at least one asset id.' };
  const list = await ctx.repo.workspacesForUser(ctx.userId);
  const { data } = await need(ctx).from('assets').select('*').in('id', want);
  const rows = ((data || []) as AssetRow[]).filter((a) => list.some((w) => w.id === a.workspace_id));
  if (!rows.length) return { error: 'None of those assets are in your workspaces.' };
  const wsIds = new Set(rows.map((r) => r.workspace_id));
  if (wsIds.size > 1) return { error: 'Those assets are in different brands. Do one brand at a time.' };
  return { rows, ws: list.find((w) => w.id === rows[0].workspace_id)! };
}
const link = (ctx: MoreCtx, q = '') => `${(ctx.appUrl || '').replace(/\/$/, '')}/${q}`;
async function wsSlug(ctx: MoreCtx, id: string) {
  const { data } = await need(ctx).from('workspaces').select('slug').eq('id', id).maybeSingle();
  return (data as any)?.slug || '';
}
async function folderFor(ctx: MoreCtx, wsId: string, folderId: unknown, name: unknown): Promise<{ id: string | null; made?: boolean } | { error: string }> {
  const db = need(ctx);
  if (folderId === null) return { id: null };
  if (folderId !== undefined) {
    const id = uuid(folderId);
    const { data } = id ? await db.from('folders').select('id').eq('id', id).eq('workspace_id', wsId).maybeSingle() : { data: null };
    return data ? { id: (data as any).id } : { error: 'That folder isn’t in this workspace. Call list_folders.' };
  }
  const n = String(name || '').trim().slice(0, 60);
  if (!n) return { error: 'Pass folder_id or folder (a name).' };
  const { data: found } = await db.from('folders').select('id, name').eq('workspace_id', wsId);
  const hit = ((found || []) as any[]).find((f) => f.name.toLowerCase() === n.toLowerCase());
  if (hit) return { id: hit.id };
  const { data, error } = await db.from('folders').insert({ workspace_id: wsId, name: n, created_by: ctx.userId }).select('id').single();
  if (error) return { error: `Couldn’t make the folder: ${error.message}` };
  return { id: (data as any).id, made: true };
}
const cleanTags = (v: unknown) => (Array.isArray(v) ? v : []).map((t) => String(t).trim().toLowerCase().slice(0, 40)).filter(Boolean);
const expiry = (days: unknown, at: unknown) => {
  if (typeof days === 'number' && days > 0) return new Date(Date.now() + Math.min(days, 3650) * 864e5).toISOString();
  if (at === null) return null;
  if (typeof at === 'string' && at) { const d = new Date(at); if (!isNaN(+d)) return d.toISOString(); }
  return undefined;
};

// Files of these assets and their versions, except any still used by another asset.
async function deleteFiles(db: SupabaseClient, wsId: string, rows: AssetRow[]) {
  const gone = new Set(rows.map((r) => r.id));
  const paths = new Set<string>();
  for (const a of rows) {
    if (a.storage_path) paths.add(a.storage_path);
    for (const s of Object.values(a.images || {}) as any[]) { if (s?.path) paths.add(s.path); }
  }
  const { data: vers } = await db.from('asset_versions').select('storage_path, images').in('asset_id', [...gone]);
  for (const v of (vers || []) as any[]) { if (v.storage_path) paths.add(v.storage_path); if (v.images?.email?.path) paths.add(v.images.email.path); }
  const { data: others } = await db.from('assets').select('id, storage_path, images').eq('workspace_id', wsId).limit(5000);
  for (const o of (others || []) as any[]) {
    if (gone.has(o.id)) continue;
    paths.delete(o.storage_path);
    for (const s of Object.values(o.images || {}) as any[]) { paths.delete(s?.path); paths.delete(s?.original_path); }
  }
  const list = [...paths].filter((p) => p && p.startsWith(wsId + '/'));
  for (let i = 0; i < list.length; i += 500) await db.storage.from('assets').remove(list.slice(i, i + 500));
}

// Used by list_assets: which ids a smart collection holds right now.
export async function collectionMembers(ctx: MoreCtx, collectionId: string, wsIds: string[]): Promise<Set<string> | { error: string }> {
  const db = need(ctx);
  const { data: c } = await db.from('collections').select('id, workspace_id, rules').eq('id', collectionId).maybeSingle();
  if (!c || !wsIds.includes((c as any).workspace_id)) return { error: 'That smart collection isn’t in your workspaces. Call list_folders.' };
  const rules = (c as any).rules as Rules;
  const hits = await collectionHits(db, (c as any).workspace_id, rules);
  const { data: rows } = await db.from('assets').select('id, kind, name, pid, description, tags, text_in_image, colour_names, on_brand, fields').eq('workspace_id', (c as any).workspace_id).limit(5000);
  return new Set(((rows || []) as any[]).filter((a) => matchesRules(a, rules, hits)).map((a) => a.id));
}


const madeIn = (a: AssetRow) => (a.provenance?.via === 'studio' && a.provenance?.spec ? 'create' : a.figma?.file_key || /figma/i.test(a.provenance?.model || '') ? 'figma' : 'upload');
const ratioOf = (s: unknown) => { const m = String(s || '').match(/^\s*(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)\s*$/); return m ? Number(m[1]) / Number(m[2]) : null; };

// ---------- the tools ----------
export async function callMoreTool(name: string, args: Record<string, any>, ctx: MoreCtx) {
  switch (name) {
    case 'get_review_queue': {
      const db = need(ctx);
      const all = await ctx.repo.workspacesForUser(ctx.userId);
      const list = args.workspace_id ? all.filter((w) => w.id === args.workspace_id) : all;
      if (!list.length) return toolError(args.workspace_id ? 'That workspace is not one of yours.' : 'You have no workspaces yet.');
      const out: any[] = [];
      for (const w of list) {
        const [{ data: assets }, kit] = await Promise.all([db.from('assets').select('*').eq('workspace_id', w.id).limit(3000), ctx.repo.getBrandKit(w.id)]);
        const q = reviewQueue((assets || []) as AssetRow[], kit);
        out.push({
          workspace_id: w.id, workspace: w.name, needs_you: q.count, this_week: summaryLine(q.summary),
          items: q.items.slice(0, 60).map((i) => ({ section: SECTION[i.kind].title, kind: i.kind, asset_id: i.asset_id, looks_like: i.other_id, product_ids: i.asset_ids?.slice(0, 20), name: i.title, detail: i.detail, can: i.actions.filter((x) => !x.startsWith('open')) })),
          more: Math.max(0, q.items.length - 60),
          open_in_mise: link(ctx, '?review=1'),
        });
      }
      return text({ brands: out, how_to: 'view_image shows any file. approve_assets, delete_assets (confirm first) and resolve_review_item settle items; only do what the user decides.' });
    }
    case 'approve_assets': {
      const r = await ownAssets(ctx, ids(args.asset_ids));
      if ('error' in r) return toolError(r.error);
      const drafts = r.rows.filter((a) => a.status === 'draft').map((a) => a.id);
      if (!drafts.length) return text({ ok: true, approved: 0, note: 'They were already approved.' });
      const { error } = await need(ctx).from('assets').update({ status: 'approved' }).in('id', drafts);
      if (error) return toolError(error.message);
      return text({ ok: true, approved: drafts.length, names: r.rows.filter((a) => drafts.includes(a.id)).map((a) => a.name) });
    }
    case 'delete_assets': {
      const r = await ownAssets(ctx, ids(args.asset_ids, 100));
      if ('error' in r) return toolError(r.error);
      const db = need(ctx);
      await deleteFiles(db, r.ws.id, r.rows);
      const { error } = await db.from('assets').delete().in('id', r.rows.map((a) => a.id));
      if (error) return toolError(error.message);
      return text({ ok: true, deleted: r.rows.map((a) => a.name) });
    }
    case 'resolve_review_item': {
      const r = await ownAssets(ctx, ids(args.asset_id, 1));
      if ('error' in r) return toolError(r.error);
      const a = r.rows[0];
      const patch = args.action === 'keep_both' ? { duplicate_ok: true }
        : args.action === 'on_brand' ? { on_brand: true, on_brand_reason: 'Checked by a person', edited: [...new Set([...(a.edited || []), 'on_brand'])] }
        : args.action === 'retry' ? { ai_status: 'pending', ai_attempts: 0, ai_error: null } : null;
      if (!patch) return toolError('action must be keep_both, on_brand or retry.');
      await ctx.repo.updateAsset(a.id, patch);
      return text({ ok: true, asset: a.name, done: args.action === 'retry' ? 'Organising it again now.' : args.action === 'keep_both' ? 'Kept both.' : 'Marked as on-brand.' });
    }
    case 'update_asset': {
      const r = await ownAssets(ctx, ids(args.asset_id, 1));
      if ('error' in r) return toolError(r.error);
      const a = r.rows[0];
      const patch: Record<string, any> = {};
      const edited = new Set<string>(a.edited || []);
      if (typeof args.name === 'string' && args.name.trim()) patch.name = args.name.trim().slice(0, 120);
      if (typeof args.alt === 'string') { patch.fields = { ...(a.fields || {}), alt: args.alt.trim().slice(0, 300) }; edited.add('alt'); }
      if (typeof args.description === 'string') { patch.description = args.description.trim().slice(0, 1000) || null; edited.add('description'); }
      if (args.tags || args.add_tags || args.remove_tags) {
        let t: string[] = args.tags ? cleanTags(args.tags) : [...(a.tags || [])];
        for (const x of cleanTags(args.add_tags)) if (!t.includes(x)) t.push(x);
        const rm = new Set(cleanTags(args.remove_tags));
        t = t.filter((x) => !rm.has(x)).slice(0, 40);
        patch.tags = t; edited.add('tags');
      }
      if (args.kind === 'image' || args.kind === 'logo') { if (!['image', 'logo'].includes(a.kind)) return toolError(`A ${a.kind} can’t become a ${args.kind}.`); patch.kind = args.kind; }
      if (args.focus && typeof args.focus.x === 'number' && typeof args.focus.y === 'number') patch.focus = { x: Math.min(1, Math.max(0, args.focus.x)), y: Math.min(1, Math.max(0, args.focus.y)) };
      let made = false;
      if ('folder_id' in args || args.folder) {
        const f = await folderFor(ctx, a.workspace_id, 'folder_id' in args ? args.folder_id : undefined, args.folder);
        if ('error' in f) return toolError(f.error);
        patch.folder_id = f.id; made = !!f.made;
      }
      // Availability: archive, obsolete (with a replacement) and licence dates. The last two are on Pro.
      const wantsPro = args.availability === 'obsolete' || args.replaced_by || 'licence_expires_at' in args;
      if (wantsPro && ctx.db && (await planOf(ctx.db, a.workspace_id)).plan === 'free') return toolError('Licence dates and obsolete files with replacements are on Pro. The brand’s owner can upgrade in Mise → Settings → Plan. Archiving works on every plan.');
      if ('licence_expires_at' in args) {
        if (args.licence_expires_at === null || args.licence_expires_at === '') patch.licence_expires_at = null;
        else { const t = Date.parse(String(args.licence_expires_at)); if (isNaN(t)) return toolError('licence_expires_at must be a date, e.g. 2026-12-31.'); patch.licence_expires_at = new Date(t).toISOString(); if (t <= Date.now()) Object.assign(patch, lifecyclePatch('expired', 'Licence expired')); }
      }
      if (args.availability) {
        if (!['available', 'archived', 'obsolete'].includes(args.availability)) return toolError('availability must be available, archived or obsolete.');
        Object.assign(patch, lifecyclePatch(args.availability === 'available' ? 'active' : args.availability, args.availability_reason));
        if (args.availability !== 'obsolete') patch.replaced_by = null;
      }
      if ('replaced_by' in args) {
        if (args.replaced_by) {
          const rr = await ownAssets(ctx, [String(args.replaced_by)]);
          if ('error' in rr || rr.rows[0].workspace_id !== a.workspace_id || rr.rows[0].id === a.id) return toolError('replaced_by must be another asset in the same brand.');
        }
        patch.replaced_by = args.replaced_by || null;
      }
      if ('lifecycle' in patch) patch.lifecycle_by = ctx.userId;
      if (!Object.keys(patch).length) return toolError('Nothing to change: pass at least one field.');
      if (edited.size !== (a.edited || []).length) patch.edited = [...edited];
      await ctx.repo.updateAsset(a.id, patch);
      const fresh = await ctx.repo.getAsset(a.id);
      return text({ ok: true, asset: publicAsset(fresh || { ...a, ...patch }, r.ws), ...(made ? { note: 'Made a new folder for it.' } : {}) });
    }
    case 'move_to_folder': {
      const r = await ownAssets(ctx, ids(args.asset_ids, 500));
      if ('error' in r) return toolError(r.error);
      const f = await folderFor(ctx, r.ws.id, 'folder_id' in args ? args.folder_id : undefined, args.folder);
      if ('error' in f) return toolError(f.error);
      const { error } = await need(ctx).from('assets').update({ folder_id: f.id }).in('id', r.rows.map((a) => a.id));
      if (error) return toolError(error.message);
      return text({ ok: true, moved: r.rows.length, folder_id: f.id, ...(f.made ? { note: 'Made a new folder.' } : {}) });
    }
    case 'list_folders': {
      const w = await workspace(ctx, args.workspace_id);
      if ('error' in w) return toolError(w.error);
      const db = need(ctx);
      const [{ data: folders }, { data: colls }, { data: rows }] = await Promise.all([
        db.from('folders').select('id, name').eq('workspace_id', w.ws.id).order('name'),
        db.from('collections').select('id, name, rules').eq('workspace_id', w.ws.id).order('position'),
        db.from('assets').select('id, kind, name, pid, description, tags, text_in_image, colour_names, on_brand, fields, folder_id').eq('workspace_id', w.ws.id).neq('kind', 'block').limit(5000),
      ]);
      const all = (rows || []) as any[];
      const collections: any[] = [];
      for (const c of (colls || []) as any[]) {
        const hits = await collectionHits(db, w.ws.id, c.rules);
        collections.push({ id: c.id, name: c.name, rule: describeRules(c.rules), files: all.filter((a) => matchesRules(a, c.rules, hits)).length });
      }
      return text({
        folders: ((folders || []) as any[]).map((f) => ({ id: f.id, name: f.name, files: all.filter((a) => a.folder_id === f.id).length })),
        unfiled: all.filter((a) => !a.folder_id).length,
        smart_collections: collections,
      });
    }
    case 'create_collection': {
      const w = await workspace(ctx, args.workspace_id);
      if ('error' in w) return toolError(w.error);
      const db = need(ctx);
      const name = String(args.name || '').trim().slice(0, 60);
      if (!name) return toolError('Give the collection a name.');
      const rules: Rules = {};
      const tags = cleanTags(args.tags);
      if (tags.length) { rules.tags = tags; if (tags.length > 1) rules.match = args.match === 'all' ? 'all' : 'any'; }
      const kinds = (Array.isArray(args.kinds) ? args.kinds : []).filter((k: string) => ['image', 'logo', 'product', 'video'].includes(k));
      if (kinds.length) rules.kinds = kinds;
      if (typeof args.on_brand === 'boolean') rules.on_brand = args.on_brand;
      const describe = String(args.describe || '').trim().slice(0, 200);
      if (describe) {
        rules.text = describe;
        const s = await searchAssets(db, { ws: [w.ws.id], q: describe, understand: describe.split(/\s+/).length >= 3, limit: 5 }).catch(() => null);
        if (s?.understood) rules.ai = { text: s.text, filters: Object.fromEntries(Object.entries(s.filters || {}).filter(([k]) => k !== 'kinds')) };
      }
      if (!Object.keys(rules).length) return toolError('Add at least one rule: describe, tags, kinds or on_brand.');
      const { count } = await db.from('collections').select('id', { count: 'exact', head: true }).eq('workspace_id', w.ws.id);
      const { data, error } = await db.from('collections').insert({ workspace_id: w.ws.id, name, rules, position: count || 0, created_by: ctx.userId }).select('id').single();
      if (error) return toolError(error.message);
      const members = await collectionMembers(ctx, (data as any).id, [w.ws.id]);
      return text({ ok: true, collection_id: (data as any).id, name, rule: describeRules(rules), files_now: members instanceof Set ? members.size : null, reading: rules.ai?.text || null });
    }
    case 'delete_folder_or_collection': {
      const db = need(ctx);
      const mine = (await ctx.repo.workspacesForUser(ctx.userId)).map((w) => w.id);
      const table = args.folder_id ? 'folders' : args.collection_id ? 'collections' : null;
      const id = uuid(args.folder_id || args.collection_id);
      if (!table || !id) return toolError('Pass folder_id or collection_id.');
      const { data } = await db.from(table).select('id, name, workspace_id').eq('id', id).maybeSingle();
      if (!data || !mine.includes((data as any).workspace_id)) return toolError('Not found in your workspaces.');
      if (table === 'folders') await db.from('assets').update({ folder_id: null }).eq('folder_id', id);
      const { error } = await db.from(table).delete().eq('id', id);
      if (error) return toolError(error.message);
      return text({ ok: true, deleted: (data as any).name });
    }
    case 'edit_image': {
      const r = await ownAssets(ctx, ids(args.asset_id, 1));
      if ('error' in r) return toolError(r.error);
      const a = r.rows[0];
      const locked = await proOnly(ctx, a.workspace_id, 'edit');
      if (locked) return toolError(locked);
      const db = need(ctx);
      if (!['image', 'logo', 'product'].includes(a.kind) || !a.storage_path) return toolError(`“${a.name}” has no photo to edit.`);
      const m = madeIn(a);
      if (m === 'create') return toolError(`“${a.name}” was made in Create, so it’s edited in Mise’s Create editor with its layout live: ${link(ctx, `?asset=${a.id}`)}`);
      if (m === 'figma') return toolError(`“${a.name}” was made in Figma, so it’s edited in Figma: change the frame there, then save it back with add_generated_asset and replaces_asset_id "${a.id}".`);
      const kitRow = await ctx.repo.getBrandKit(a.workspace_id);
      const presets = sizePresets(Number(kitRow?.kit?.layout?.width) || 600, Array.isArray(kitRow?.kit?.presets) ? kitRow!.kit.presets : []);
      const e: ServerEdit = { focus: a.focus || null };
      if (args.preset) {
        const p = presets[String(args.preset).toLowerCase()];
        if (!p) return toolError(`Unknown preset. Sizes: ${Object.keys(presets).join(', ')}.`);
        e.width = p.w; e.height = p.h;
      }
      if (args.width) e.width = Number(args.width);
      if (args.height) e.height = Number(args.height);
      if (args.ratio) { const ro = ratioOf(args.ratio); if (!ro) return toolError('ratio looks like "4:5".'); e.ratio = ro; }
      if (args.crop) e.crop = { x: Number(args.crop.x) || 0, y: Number(args.crop.y) || 0, w: Number(args.crop.w) || 1, h: Number(args.crop.h) || 1 };
      if ([90, 180, 270].includes(Number(args.rotate))) e.rotate = Number(args.rotate) as 90 | 180 | 270;
      if (args.flip) e.flip = true;
      if (args.brightness) e.brightness = Number(args.brightness);
      if (args.saturation) e.saturation = Number(args.saturation);
      if (!e.width && !e.height && !e.ratio && !e.crop && !e.rotate && !e.flip && !e.brightness && !e.saturation) return toolError('Say what to change: a preset, width/height, ratio, crop, rotate, flip, brightness or saturation.');
      const file = await ctx.repo.download(a.storage_path);
      if (!file) return toolError('Couldn’t read the file from storage.');
      const out = await editImage(Buffer.from(await file.blob.arrayBuffer()), a.mime || file.mime, e);
      if ('error' in out) return toolError(out.error);
      const ext = IMAGE_EXT[out.mime] || 'jpg';
      const path = `${a.workspace_id}/edits/${crypto.randomUUID()}.${ext}`;
      await ctx.repo.upload(path, out.buf, out.mime);
      const images = await uploadEmailCopy(db, a.workspace_id, out.buf, out.mime);
      const note = describeEdit(e, { w: out.width, h: out.height });
      const fileRow = { storage_path: path, mime: out.mime, width: out.width, height: out.height, bytes: out.buf.length, images, phash: null, by: ctx.userId };
      if (args.save_as === 'copy') {
        const { data, error } = await db.rpc('asset_save_copy', { p_asset: a.id, p_file: fileRow, p_name: String(args.name || `${a.name} (${args.preset || `${out.width}×${out.height}`})`), p_note: note });
        if (error) return toolError(`Couldn’t save the copy: ${error.message}`);
        return text({ ok: true, saved: 'copy', asset: publicAsset(data as AssetRow, r.ws), note, mise_link: link(ctx, `?asset=${(data as any).id}`) });
      }
      const row = ctx.repo.newVersion ? await ctx.repo.newVersion(a.id, fileRow, note, null) : null;
      if (!row) return toolError('Couldn’t save the new version.');
      return text({ ok: true, saved: `version ${row.version}`, asset: publicAsset(row, r.ws), note, undo: `revert_asset with version ${row.version - 1}`, mise_link: link(ctx, `?asset=${a.id}`) });
    }
    case 'list_versions': {
      const r = await ownAssets(ctx, ids(args.asset_id, 1));
      if ('error' in r) return toolError(r.error);
      const a = r.rows[0];
      const { data } = await need(ctx).from('asset_versions').select('version, note, width, height, created_at').eq('asset_id', a.id).order('version', { ascending: false }).limit(50);
      return text({ asset: a.name, current: { version: a.version || 1, note: a.version_note || (a.version > 1 ? null : 'Original'), width: a.width, height: a.height }, earlier: data || [] });
    }
    case 'revert_asset': {
      const r = await ownAssets(ctx, ids(args.asset_id, 1));
      if ('error' in r) return toolError(r.error);
      { const locked = await proOnly(ctx, r.rows[0].workspace_id, 'edit'); if (locked) return toolError(locked); }
      const { data, error } = await need(ctx).rpc('asset_revert', { p_asset: r.rows[0].id, p_version: Math.round(Number(args.version)) });
      if (error) return toolError(/Version not found/.test(error.message) ? 'No such version. Call list_versions.' : error.message);
      return text({ ok: true, asset: publicAsset(data as AssetRow, r.ws), note: `Version ${args.version} is current again (as version ${(data as any).version}).` });
    }
    case 'create_share_link': {
      const w = await workspace(ctx, args.workspace_id);
      if ('error' in w) return toolError(w.error);
      { const locked = await proOnly(ctx, w.ws.id, 'share'); if (locked) return toolError(locked); }
      const db = need(ctx);
      const assetIds = ids(args.asset_ids, 500);
      const kind = assetIds.length ? 'assets' : args.folder_id ? 'folder' : args.collection_id ? 'collection' : null;
      if (!kind) return toolError('Say what to share: asset_ids, folder_id or collection_id.');
      const formats = (Array.isArray(args.formats) ? args.formats : SHARE_FORMATS).filter((f: string) => (SHARE_FORMATS as readonly string[]).includes(f));
      const row: Record<string, any> = {
        workspace_id: w.ws.id, token: newToken(), kind,
        title: String(args.title || 'Shared files').trim().slice(0, 120) || 'Shared files',
        message: args.message ? String(args.message).slice(0, 1000) : null,
        expires_at: expiry(args.expires_in_days, args.expires_at) ?? null,
        passcode_hash: args.passcode ? hashPasscode(String(args.passcode).slice(0, 100)) : null,
        allow_download: args.allow_download !== false,
        formats: formats.length ? formats : ['original'],
        created_by: ctx.userId,
      };
      if (kind === 'assets') {
        const { data } = await db.from('assets').select('id').eq('workspace_id', w.ws.id).in('id', assetIds);
        row.asset_ids = ((data || []) as any[]).map((x) => x.id);
        if (!row.asset_ids.length) return toolError('None of those files are in this workspace.');
      } else {
        const id = uuid(kind === 'folder' ? args.folder_id : args.collection_id);
        const { data } = id ? await db.from(kind === 'folder' ? 'folders' : 'collections').select('id').eq('workspace_id', w.ws.id).eq('id', id).maybeSingle() : { data: null };
        if (!data) return toolError(`That ${kind} isn’t in this workspace. Call list_folders.`);
        row[kind === 'folder' ? 'folder_id' : 'collection_id'] = id;
      }
      const { data, error } = await db.from('shares').insert(row).select('id, token, title, kind, expires_at, allow_download, formats').single();
      if (error) return toolError(error.message);
      return text({ ok: true, url: link(ctx, `s/${(data as any).token}`), share_id: (data as any).id, title: (data as any).title, holds: kind === 'assets' ? `${row.asset_ids.length} file${row.asset_ids.length === 1 ? '' : 's'}` : kind === 'folder' ? 'a folder (new files show up too)' : 'a smart collection (it keeps filling)', expires_at: (data as any).expires_at, passcode: !!row.passcode_hash, downloads: (data as any).allow_download });
    }
    case 'list_share_links': {
      const w = await workspace(ctx, args.workspace_id);
      if ('error' in w) return toolError(w.error);
      const { data } = await need(ctx).from('shares').select('*').eq('workspace_id', w.ws.id).order('created_at', { ascending: false }).limit(50);
      return text(((data || []) as any[]).map((s) => ({ share_id: s.id, title: s.title, url: link(ctx, `s/${s.token}`), state: shareState(s as any), holds: s.kind === 'assets' ? `${s.asset_ids?.length || 0} files` : s.kind, views: s.views, downloads: s.downloads, last_viewed_at: s.last_viewed_at, expires_at: s.expires_at, passcode: !!s.passcode_hash, created_at: s.created_at })));
    }
    case 'update_share_link': {
      const db = need(ctx);
      const id = uuid(args.share_id);
      const { data: s } = id ? await db.from('shares').select('id, workspace_id, token').eq('id', id).maybeSingle() : { data: null };
      const mine = (await ctx.repo.workspacesForUser(ctx.userId)).map((w) => w.id);
      if (!s || !mine.includes((s as any).workspace_id)) return toolError('Link not found in your workspaces.');
      const patch: Record<string, any> = {};
      if (args.revoke === true) patch.revoked_at = new Date().toISOString();
      if (args.restore === true) patch.revoked_at = null;
      const ex = expiry(args.expires_in_days, args.expires_at);
      if (ex !== undefined) patch.expires_at = ex;
      if (typeof args.passcode === 'string') patch.passcode_hash = args.passcode ? hashPasscode(args.passcode.slice(0, 100)) : null;
      if (typeof args.allow_download === 'boolean') patch.allow_download = args.allow_download;
      if (typeof args.title === 'string' && args.title.trim()) patch.title = args.title.trim().slice(0, 120);
      if (!Object.keys(patch).length) return toolError('Nothing to change.');
      const { error } = await db.from('shares').update(patch).eq('id', (s as any).id);
      if (error) return toolError(error.message);
      return text({ ok: true, url: link(ctx, `s/${(s as any).token}`), changed: Object.keys(patch).map((k) => k.replace('_hash', '')) });
    }
    case 'list_portals': {
      const w = await workspace(ctx, args.workspace_id);
      if ('error' in w) return toolError(w.error);
      const slug = await wsSlug(ctx, w.ws.id);
      const { data } = await need(ctx).from('portals').select('*').eq('workspace_id', w.ws.id).order('created_at');
      return text(((data || []) as any[]).map(({ passcode_hash, ...p }) => ({ portal_id: p.id, name: p.name, url: link(ctx, `p/${slug}/${p.slug}`), published: p.published, access: p.access, passcode: !!passcode_hash, allowlist: p.allowlist, include_all: p.include_all, folder_ids: p.folder_ids, collection_ids: p.collection_ids, allow_download: p.allow_download, show_guidelines: p.show_guidelines, intro: p.intro })));
    }
    case 'save_portal': {
      const w = await workspace(ctx, args.workspace_id);
      if ('error' in w) return toolError(w.error);
      // Free: the portal can be built and previewed by the team; publishing it is on Pro.
      if (args.published === true && (await proOnly(ctx, w.ws.id, 'share'))) return toolError('The portal can be set up on Free, but publishing it is on Pro. Save it without published: true, and the brand’s owner can upgrade in Mise → Settings → Plan & usage to publish.');
      const db = need(ctx);
      const f: Record<string, any> = {};
      if (typeof args.name === 'string') f.name = args.name.trim().slice(0, 80) || 'Brand portal';
      if (typeof args.intro === 'string') f.intro = args.intro.slice(0, 1000) || null;
      for (const k of ['include_all', 'allow_download', 'published', 'show_guidelines']) if (typeof args[k] === 'boolean') f[k] = args[k];
      if (['public', 'passcode', 'allowlist'].includes(args.access)) f.access = args.access;
      if (typeof args.passcode === 'string') f.passcode_hash = args.passcode ? hashPasscode(args.passcode.slice(0, 100)) : null;
      if (Array.isArray(args.allowlist)) f.allowlist = args.allowlist.map((x: string) => String(x).trim().toLowerCase()).filter((x: string) => /^(@[\w.-]+\.[a-z]{2,}|[^@\s]+@[\w.-]+\.[a-z]{2,})$/.test(x)).slice(0, 500);
      for (const [key, table] of [['folder_ids', 'folders'], ['collection_ids', 'collections']] as const) {
        if (!Array.isArray(args[key])) continue;
        const want = ids(args[key]);
        const { data } = want.length ? await db.from(table).select('id').eq('workspace_id', w.ws.id).in('id', want) : { data: [] };
        f[key] = ((data || []) as any[]).map((r) => r.id);
      }
      const slug = await wsSlug(ctx, w.ws.id);
      let portal: any;
      if (args.portal_id) {
        const { data: p } = await db.from('portals').select('id, workspace_id, access, passcode_hash').eq('id', uuid(args.portal_id) || '').maybeSingle();
        if (!p || (p as any).workspace_id !== w.ws.id) return toolError('That portal isn’t in this workspace. Call list_portals.');
        if ((f.access || (p as any).access) === 'passcode' && !('passcode_hash' in f ? f.passcode_hash : (p as any).passcode_hash)) return toolError('A passcode portal needs a passcode.');
        const { data, error } = await db.from('portals').update(f).eq('id', (p as any).id).select('*').single();
        if (error) return toolError(error.message);
        portal = data;
      } else {
        if (f.access === 'passcode' && !f.passcode_hash) return toolError('A passcode portal needs a passcode.');
        const base = (String(f.name || 'brand').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 36)) || 'brand';
        let s = base, n = 1;
        for (;;) { const { data } = await db.from('portals').select('id').eq('workspace_id', w.ws.id).eq('slug', s).maybeSingle(); if (!data) break; n++; s = `${base}-${n}`; }
        const { data, error } = await db.from('portals').insert({ workspace_id: w.ws.id, created_by: ctx.userId, name: 'Brand portal', ...f, slug: s }).select('*').single();
        if (error) return toolError(error.message);
        portal = data;
      }
      return text({ ok: true, portal_id: portal.id, name: portal.name, url: link(ctx, `p/${slug}/${portal.slug}`), published: portal.published, access: portal.access });
    }
    case 'import_from_urls': {
      const w = await workspace(ctx, args.workspace_id);
      if ('error' in w) return toolError(w.error);
      const db = need(ctx);
      const urls = (Array.isArray(args.urls) ? args.urls : []).map(String).filter((u: string) => /^https:\/\//i.test(u)).slice(0, 25);
      if (!urls.length) return toolError('Pass https links to images or videos.');
      let folderId: string | null = null;
      if (args.folder) { const f = await folderFor(ctx, w.ws.id, undefined, args.folder); if ('error' in f) return toolError(f.error); folderId = f.id; }
      const added: any[] = [], failed: any[] = [];
      for (const u of urls) {
        const got = await fetchLimited(u, { accept: 'image/*,video/*', maxBytes: MAX_IMPORT_BYTES, timeoutMs: 30000, fetchImpl: ctx.fetchImpl });
        if ('error' in got) { failed.push({ url: u, why: got.error }); continue; }
        let type = got.type;
        const ext0 = new URL(u).pathname.toLowerCase().match(/\.(png|jpe?g|webp|gif|svg|mp4|webm)$/)?.[1];
        if (!/^(image|video)\//.test(type) && ext0) type = ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm' } as Record<string, string>)[ext0];
        if (!/image\/(png|jpeg|webp|gif|svg\+xml)|video\/(mp4|webm)/.test(type)) { failed.push({ url: u, why: `not an image or video (${got.type || 'unknown'})` }); continue; }
        const video = type.startsWith('video/');
        if (!video && got.buf.length > MAX_IMAGE_BYTES) { failed.push({ url: u, why: 'over 50 MB' }); continue; }
        const ext = IMAGE_EXT[type] || (type === 'video/webm' ? 'webm' : 'mp4');
        const path = `${w.ws.id}/${crypto.randomUUID()}.${ext}`;
        await ctx.repo.upload(path, got.buf, type);
        const size = video ? null : imageSize(got.buf);
        const images = video ? {} : await uploadEmailCopy(db, w.ws.id, got.buf, type);
        const base = decodeURIComponent(new URL(u).pathname.split('/').pop() || 'Imported file').replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim().slice(0, 120) || 'Imported file';
        const row = await ctx.repo.insertAsset({
          workspace_id: w.ws.id, kind: video ? 'video' : args.kind === 'logo' ? 'logo' : 'image', name: base, storage_path: path, mime: type, bytes: got.buf.length,
          width: size?.w ?? null, height: size?.h ?? null, images, folder_id: folderId, origin: 'uploaded', status: 'approved', created_by: ctx.userId,
          provenance: { via: 'claude_import', imported_from: u.slice(0, 500), at: new Date().toISOString() },
        });
        added.push({ id: row.id, name: row.name });
      }
      return text({ ok: !!added.length, added, failed, note: added.length ? 'Mise is organising them now (tags, alt text, brand check). New possible duplicates show up in the review queue.' : undefined });
    }
    case 'get_upload_link': {
      const w = await workspace(ctx, args.workspace_id);
      if ('error' in w) return toolError(w.error);
      return text({ url: link(ctx, `?brand=${w.ws.id}`), how_to: `Open the link and drop files or whole folders onto ${w.ws.name}’s library. Mise sizes and organises them.` });
    }
    case 'create_brand': {
      const db = need(ctx);
      const name = String(args.name || '').trim().slice(0, 60);
      if (!name) return toolError('Give the brand a name.');
      // The same rules as the app: one free brand per person, further brands through checkout as Pro,
      // and on an Enterprise account owners and admins add brands straight away (up to the brands agreed).
      const { data: w, error } = await db.rpc('create_brand_for', { p_user: ctx.userId, p_name: name, p_from: null });
      if (error && /FREE_BRAND_LIMIT/.test(error.message)) return toolError(`Each extra brand is on Pro, so it starts at checkout. Add it in Mise: click the brand name at the top of the sidebar → New brand. ${link(ctx)}`);
      if (error && /BRAND_LIMIT/.test(error.message)) return toolError(error.message.replace(/^.*BRAND_LIMIT:\s*/, ''));
      if (error || !w) return toolError(`Couldn’t make the brand: ${error?.message}`);
      let kit: any = null;
      if (args.website) {
        const r = await brandKitFromWebsite(db, w as any, ctx.userId, String(args.website));
        kit = r.ok ? { status: 'draft', missing: r.missing, warnings: r.warnings, found: r.found } : { error: r.error };
      }
      return text({ ok: true, workspace_id: (w as any).id, name, brand_kit: kit, open_in_mise: link(ctx, `?brand=${(w as any).id}`), next: kit && !kit.error ? 'The brand kit is a draft: show the user what was found and ask them to check and approve it.' : 'Next: build the brand kit (brand_kit_from_website, or from Figma with save_brand_kit) and add files.' });
    }
    case 'brand_kit_from_website': {
      const w = await workspace(ctx, args.workspace_id);
      if ('error' in w) return toolError(w.error);
      const r = await brandKitFromWebsite(need(ctx), w.ws, ctx.userId, String(args.url || ''));
      if (!r.ok) return toolError(r.error);
      const k = r.kit?.kit || {};
      return text({ ok: true, status: 'draft', colours: k.colors, fonts: { heading: k.type?.heading?.family, body: k.type?.body?.family }, button: k.button, logo: r.found.logo, reference_photo: r.found.photo, renamed: r.renamed, missing: r.missing, warnings: r.warnings, next: 'Saved as a draft. Show the user the colours, fonts and logo; approve_brand_kit only when they say it’s right.' });
    }
    case 'approve_brand_kit': {
      const w = await workspace(ctx, args.workspace_id);
      if ('error' in w) return toolError(w.error);
      if (!['owner', 'admin'].includes(w.ws.role)) return toolError('Only admins and owners can approve the brand kit. Ask one of them.');
      const kit = await ctx.repo.getBrandKit(w.ws.id);
      if (!kit) return toolError('There’s no brand kit yet.');
      if (kit.status === 'approved') return text({ ok: true, note: 'It was already approved.' });
      const { error } = await need(ctx).from('brand_kits').update({ status: 'approved', approved_by: ctx.userId, approved_at: new Date().toISOString() }).eq('workspace_id', w.ws.id);
      if (error) return toolError(error.message);
      return text({ ok: true, note: 'Approved. Mise and Claude use it from now on.' });
    }
    case 'invite_teammate': {
      const w = await workspace(ctx, args.workspace_id);
      if ('error' in w) return toolError(w.error);
      if (!['owner', 'admin'].includes(w.ws.role)) return toolError('Only admins and owners can invite people. Ask one of them.');
      const email = String(args.email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toolError('That isn’t a valid email address.');
      const db = need(ctx);
      const { error } = await db.from('workspace_invites').upsert({ workspace_id: w.ws.id, email, role: ['admin', 'editor', 'contributor', 'viewer'].includes(args.role) ? args.role : 'editor', invited_by: ctx.userId, accepted_at: null }, { onConflict: 'workspace_id,email' });
      if (error) return toolError(error.message.replace(/^ROLE: /, ''));
      const { error: ie } = await db.auth.admin.inviteUserByEmail(email, { redirectTo: link(ctx, 'login') });
      const existing = !!ie && /already|registered|exists/i.test(ie.message);
      if (ie && !existing) return toolError(ie.message);
      return text({ ok: true, note: existing ? `${email} already has an account: they’ll see ${w.ws.name} next time they open Mise.` : `Invite sent to ${email}.` });
    }
    default:
      return null;
  }
}
