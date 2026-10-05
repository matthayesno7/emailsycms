// Run: npx tsx scripts/connector-selftest.ts  (needs sharp; uses an in-memory database)
import sharp from 'sharp';
import { fakeDb } from './fakedb';
import { supabaseRepo } from '../lib/mcp/repo';
import { handleMessage } from '../lib/mcp/server';
import { reviewQueue, summaryLine } from '../lib/review';

const WS = '11111111-1111-1111-1111-111111111111', OTHER = '99999999-9999-9999-9999-999999999999', U = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const now = new Date().toISOString();
let fails = 0;
const ok = (c: any, m: string) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };

async function main() {
  const jpg = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#3366aa' } }).jpeg().toBuffer();
  const db = fakeDb({
    workspaces: [{ id: WS, name: 'Email Love', slug: 'email-love' }, { id: OTHER, name: 'Not mine', slug: 'x' }],
    assets: [
      { id: id(1), workspace_id: WS, kind: 'image', name: 'Beach hero', status: 'approved', storage_path: `${WS}/a.jpg`, mime: 'image/jpeg', width: 3000, height: 2000, tags: ['beach'], created_at: now, ai_status: 'done', ai: { at: now }, fields: { alt: 'x' }, focus: { x: 0.8, y: 0.5 }, version: 1 },
      { id: id(2), workspace_id: WS, kind: 'image', name: 'Banner draft', status: 'draft', origin: 'generated', provenance: { via: 'studio', spec: {}, prompt: 'Summer sale banner' }, storage_path: `${WS}/b.png`, created_at: now },
      { id: id(3), workspace_id: WS, kind: 'image', name: 'Beach hero copy', status: 'approved', duplicate_of: id(1), duplicate_ok: false, storage_path: `${WS}/c.jpg`, created_at: now },
      { id: id(4), workspace_id: WS, kind: 'image', name: 'Neon thing', status: 'approved', on_brand: false, on_brand_reason: 'Neon colours', storage_path: `${WS}/d.jpg`, edited: [] },
      { id: id(5), workspace_id: WS, kind: 'image', name: 'Broken', status: 'approved', ai_status: 'failed', ai_error: 'Claude couldn’t read this image.', storage_path: `${WS}/e.jpg` },
      { id: id(6), workspace_id: WS, kind: 'product', name: 'Linen shirt', pid: 'LS1', status: 'approved' },
      { id: id(7), workspace_id: OTHER, kind: 'image', name: 'Secret', status: 'draft', storage_path: `${OTHER}/s.jpg` },
    ],
    brand_kits: [{ workspace_id: WS, status: 'draft', version: 1, kit: { layout: { width: 600 }, presets: [{ name: 'Hero', w: 1000, h: 400 }] } }],
    folders: [], collections: [], shares: [], portals: [], asset_versions: [], workspace_members: [], workspace_invites: [],
  });
  db.files.set(`${WS}/a.jpg`, jpg);
  db.files.set(`${WS}/c.jpg`, jpg);
  const repo = supabaseRepo(db);
  repo.workspacesForUser = async () => [{ id: WS, name: 'Email Love', role: 'owner' }];
  const ctx = { repo, userId: U, db, appUrl: 'https://mise.test' };
  let n = 0;
  const call = async (name: string, args: any = {}) => {
    const r: any = await handleMessage({ jsonrpc: '2.0', id: ++n, method: 'tools/call', params: { name, arguments: args } }, ctx);
    const t = r.result?.content?.[0]?.text ?? JSON.stringify(r.error);
    let j: any = t; try { j = JSON.parse(t); } catch {}
    return { err: !!r.result?.isError || !!r.error, j, t };
  };

  // pure queue
  const q = reviewQueue(db.T.assets.filter((a: any) => a.workspace_id === WS), db.T.brand_kits[0]);
  ok(q.items.map((i) => i.kind).join(',') === 'draft,duplicate,off_brand,failed,no_image,brand_kit', 'queue order and kinds: ' + q.items.map((i) => i.kind).join(','));
  console.log('     ', summaryLine(q.summary));

  const list: any = await handleMessage({ jsonrpc: '2.0', id: 0, method: 'tools/list' }, ctx);
  ok(list.result.tools.length === 34 && list.result.tools.some((t: any) => t.name === 'get_review_queue'), `tools/list has ${list.result.tools.length} tools`);
  const init: any = await handleMessage({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} }, ctx);
  ok(init.result.instructions.includes('Running Mise from Claude'), 'instructions include the new section');

  let r = await call('get_review_queue');
  ok(!r.err && r.j.brands[0].needs_you === 6 && r.j.brands[0].open_in_mise === 'https://mise.test/?review=1', 'get_review_queue');
  ok(!JSON.stringify(r.j).includes('Secret'), 'review queue hides other workspaces');

  r = await call('approve_assets', { asset_ids: [id(2)] });
  ok(!r.err && r.j.approved === 1 && db.T.assets.find((a: any) => a.id === id(2)).status === 'approved', 'approve_assets');
  r = await call('approve_assets', { asset_ids: [id(7)] });
  ok(r.err, 'approve_assets refuses another workspace');

  r = await call('resolve_review_item', { asset_id: id(4), action: 'on_brand' });
  const a4 = db.T.assets.find((a: any) => a.id === id(4));
  ok(!r.err && a4.on_brand === true && a4.edited.includes('on_brand'), 'resolve on_brand');
  r = await call('resolve_review_item', { asset_id: id(5), action: 'retry' });
  ok(db.T.assets.find((a: any) => a.id === id(5)).ai_status === 'pending', 'resolve retry');

  r = await call('update_asset', { asset_id: id(1), add_tags: ['Summer'], remove_tags: ['beach'], folder: 'Summer 26', alt: 'A beach' });
  const a1 = db.T.assets.find((a: any) => a.id === id(1));
  ok(!r.err && a1.tags.join() === 'summer' && a1.folder_id && a1.fields.alt === 'A beach' && a1.edited.includes('tags'), 'update_asset tags, alt, new folder');
  r = await call('move_to_folder', { asset_ids: [id(3), id(4)], folder: 'summer 26' });
  ok(!r.err && db.T.folders.length === 1 && db.T.assets.find((a: any) => a.id === id(3)).folder_id === a1.folder_id, 'move_to_folder reuses folder by name');
  r = await call('list_folders', { workspace_id: WS });
  ok(!r.err && r.j.folders[0].files === 3, 'list_folders counts');
  r = await call('create_collection', { workspace_id: WS, name: 'Summer', tags: ['summer'] });
  ok(!r.err && r.j.files_now === 1, 'create_collection: ' + r.t.slice(0, 120));
  r = await call('list_assets', { workspace_id: WS, collection_id: r.j.collection_id });
  ok(!r.err && r.j.length === 1 && r.j[0].id === id(1), 'list_assets by collection');
  r = await call('list_assets', { workspace_id: WS, folder_id: a1.folder_id });
  ok(!r.err && r.j.length === 3, 'list_assets by folder');
  r = await call('list_assets', { workspace_id: WS, since: '2000-01-01' });
  ok(!r.err && r.j.length === 3, 'list_assets since (only rows with created_at)');

  r = await call('edit_image', { asset_id: id(1), preset: 'email-full' });
  ok(!r.err && a1.width === 1200 && a1.height === 600 && a1.version === 2, 'edit_image preset → version: ' + r.t.slice(0, 160));
  const edited = await sharp(db.files.get(a1.storage_path)).metadata();
  ok(edited.width === 1200 && edited.height === 600 && edited.format === 'jpeg', 'edited file is 1200×600 jpeg');
  r = await call('edit_image', { asset_id: id(1), preset: 'team:hero', save_as: 'copy' });
  ok(!r.err && r.j.asset.width === 1000 && db.T.assets.length === 8, 'edit_image team preset as copy');
  r = await call('edit_image', { asset_id: id(2), preset: 'square' });
  ok(r.err && r.t.includes('Create'), 'edit_image refuses Create designs');
  r = await call('list_versions', { asset_id: id(1) });
  ok(!r.err && r.j.current.version === 2 && r.j.earlier.length === 1, 'list_versions');
  r = await call('revert_asset', { asset_id: id(1), version: 1 });
  ok(!r.err && a1.storage_path === `${WS}/a.jpg`, 'revert_asset');

  r = await call('create_share_link', { workspace_id: WS, asset_ids: [id(1), id(7)], title: 'For the agency', passcode: 'pw', expires_in_days: 7 });
  ok(!r.err && r.j.url.startsWith('https://mise.test/s/') && r.j.holds === '1 file' && r.j.passcode, 'create_share_link drops other workspace files');
  const sid = r.j.share_id;
  r = await call('update_share_link', { share_id: sid, revoke: true });
  ok(!r.err && db.T.shares[0].revoked_at, 'revoke');
  r = await call('list_share_links', { workspace_id: WS });
  ok(!r.err && r.j[0].state === 'revoked', 'list_share_links state');
  r = await call('save_portal', { workspace_id: WS, name: 'Agency portal', access: 'passcode' });
  ok(r.err, 'portal with passcode access needs a passcode');
  r = await call('save_portal', { workspace_id: WS, name: 'Agency portal', access: 'passcode', passcode: 'x' });
  ok(!r.err && r.j.url === 'https://mise.test/p/email-love/agency-portal', 'save_portal create: ' + r.t.slice(0, 100));
  r = await call('save_portal', { workspace_id: WS, portal_id: r.j.portal_id, published: false });
  ok(!r.err && r.j.published === false, 'save_portal update');
  r = await call('list_portals', { workspace_id: WS });
  ok(!r.err && r.j.length === 1 && !('passcode_hash' in r.j[0]), 'list_portals hides hash');

  r = await call('delete_assets', { asset_ids: [id(3)] });
  ok(!r.err && !db.T.assets.some((a: any) => a.id === id(3)) && !db.files.has(`${WS}/c.jpg`), 'delete_assets removes row and file');
  ok(db.files.has(`${WS}/a.jpg`), 'delete keeps files still used elsewhere');

  r = await call('approve_brand_kit', { workspace_id: WS });
  ok(!r.err && db.T.brand_kits[0].status === 'approved', 'approve_brand_kit');
  r = await call('invite_teammate', { workspace_id: WS, email: 'Andrew@Example.com' });
  ok(!r.err && db.T.workspace_invites[0].email === 'andrew@example.com', 'invite_teammate');
  r = await call('create_brand', { name: 'Composa' });
  ok(!r.err && db.T.workspace_members[0].role === 'owner', 'create_brand');
  r = await call('get_upload_link', { workspace_id: WS });
  ok(r.j.url === `https://mise.test/?brand=${WS}`, 'get_upload_link');
  r = await call('import_from_urls', { workspace_id: WS, urls: ['http://insecure.example/x.jpg'] });
  ok(r.err, 'import_from_urls needs https');
  const fid = a1.folder_id;
  r = await call('delete_folder_or_collection', { folder_id: fid });
  ok(!r.err && !db.T.folders.length && !db.T.assets.some((a: any) => a.folder_id === fid), 'delete folder unfiles its files');

  r = await call('get_review_queue', { workspace_id: WS });
  console.log('      after:', r.j.brands[0].needs_you, 'items:', r.j.brands[0].items.map((i: any) => i.kind).join(','));
  console.log(fails ? `${fails} FAILED` : 'all passed');
}
main().catch((e) => { console.error(e); process.exit(1); });
