// Self-test for the MCP handler with an in-memory fake database.
// Run: npx tsx scripts/mcp-selftest.ts
import { handleBody } from '../lib/mcp/server';
const W1 = 'w1', W2 = 'w2';
const assets: any[] = [
  { id: 'a1', workspace_id: W1, kind: 'image', name: 'Autumn hero', storage_path: 'w1/a.jpg', width: 1600, height: 900, images: { email: { path: 'w1/email/a.jpg', width: 1200, height: 675, bytes: 120000 } } },
  { id: 'p1', workspace_id: W1, kind: 'product', name: 'Merino crew', pid: '10482', price: '£48', link: 'https://shop/p', storage_path: 'w1/p.png', fields: { description: 'Soft merino.', cta: '' } },
  { id: 'b1', workspace_id: W1, kind: 'block', name: 'Autumn block', block_type: 'hero', fields: { headline: 'Hi', cta: 'Shop', link: 'https://x' }, images: { image: { path: 'w1/blocks/b.jpg', alt: 'Sunset', original_path: 'w1/a.jpg' } } },
  { id: 'd1', workspace_id: W1, kind: 'block', name: 'Matt test', block_type: 'design', fields: { notes: 'Stars are gold' }, images: { image: { path: 'w1/blocks/d.jpg', width: 640, height: 321, original_path: 'w1/d.jpg' } } },
  { id: 'c1', workspace_id: W1, kind: 'block', name: 'Review card', block_type: 'card', fields: { layout: 'left', headline: 'Great', rating: '5', name: 'Name B.' }, images: { image: { path: 'w1/blocks/c.jpg', width: 480, height: 640 }, reference: { path: 'w1/d.jpg', width: 1200, height: 600 } } },
  { id: 'x1', workspace_id: W2, kind: 'image', name: 'Secret', storage_path: 'w2/s.jpg' },
];
const repo = {
  async workspacesForUser() { return [{ id: W1, name: 'My brand', role: 'owner' }]; },
  async listAssets(ids: string[], o: any) { return assets.filter(a => ids.includes(a.workspace_id) && (!o.kind || a.kind === o.kind) && (!o.origin || a.origin === o.origin) && (!o.status || (a.status || 'approved') === o.status) && (!o.query || (a.name + (a.pid||'')).toLowerCase().includes(o.query.toLowerCase()))).slice(0, o.limit); },
  async getAsset(id: string) { return assets.find(a => a.id === id) || null; },
  async signedUrl(p: string) { return 'https://signed/' + p; },
  async download(p: string) { return { blob: new Blob([new Uint8Array([1,2,3])], { type: p.endsWith('png') ? 'image/png' : 'image/jpeg' }), mime: p.endsWith('png') ? 'image/png' : 'image/jpeg' }; },
  async updateAsset(id: string, patch: any) { Object.assign(assets.find(a => a.id === id), patch); },
  async insertAsset(row: any) { const a = { id: '00000000-0000-4000-8000-' + String(assets.length).padStart(12, '0'), ...row }; assets.push(a); return a; },
  async upload(path: string) { uploads.push(path); },
  async getBrandKit(ws: string) { return kits[ws] || null; },
  async saveBrandKit(row: any) { kits[row.workspace_id] = { ...row }; return kits[row.workspace_id]; },
};
const uploads: string[] = [];
const kits: Record<string, any> = {};
let posted: any = null;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 4, 0xb0, 0, 0, 2, 0x58, 8, 6, 0, 0, 0]);
const fetchImpl: any = async (url: any, init: any) => {
  const u = String(url);
  if (u.includes('images.example.com')) return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
  if (u.includes('figma-logo')) return new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', { status: 200, headers: { 'content-type': 'image/svg+xml' } });
  if (u.includes('not-image')) return new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } });
  posted = { url, file: init.body.get('file') }; return new Response(JSON.stringify({ imageHash: 'abc123' }), { status: 200 });
};
const ctx = { repo, userId: 'u1', fetchImpl };
const call = async (m: any) => handleBody(m, ctx);
(async () => {
  const init: any = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  console.log('init', init.result.protocolVersion, init.result.serverInfo.name, !!init.result.instructions);
  console.log('notif', await call({ jsonrpc: '2.0', method: 'notifications/initialized' }));
  const list: any = await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  console.log('tools', list.result.tools.map((t: any) => t.name).join(','));
  const t = async (name: string, args: any) => { const r: any = await call({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } }); return r.result; };
  console.log('ws', (await t('list_workspaces', {})).content[0].text.replace(/\s+/g, ' '));
  console.log('list', JSON.parse((await t('list_assets', { query: '104' })).content[0].text).map((a: any) => a.id));
  console.log('other ws blocked', (await t('get_asset', { id: 'x1' })).isError);
  console.log('wrong ws filter', (await t('list_assets', { workspace_id: W2 })).isError);
  console.log('block', JSON.parse((await t('get_block_for_figma', { id: 'b1' })).content[0].text).fields.map((f: any) => f.key + '=' + f.value).join(' '));
  console.log('bad host', (await t('push_image_to_figma', { asset_id: 'a1', upload_url: 'https://evil.com/x' })).isError);
  const push = await t('push_image_to_figma', { asset_id: 'b1', upload_url: 'https://mcp.figma.com/mcp/upload/x/submit' });
  console.log('push', push.isError, JSON.parse(push.content[0].text).figma, posted.file.name, posted.file.size);
  console.log('record', (await t('record_figma_placement', { asset_id: 'b1', file_key: 'F', node_id: '1:2' })).isError, assets[2].figma.node_id);
  const d = JSON.parse((await t('get_block_for_figma', { id: 'd1' })).content[0].text);
  console.log('design', d.rebuild, JSON.stringify(d.images.image.size_px), d.how_to.slice(0, 40));
  const v = await t('view_image', { asset_id: 'd1' });
  console.log('view', v.content[0].type, v.content[0].mimeType, v.content[0].data, v.content[1].text);
  console.log('view other ws', (await t('view_image', { asset_id: 'x1' })).isError);
  console.log('hero how_to', JSON.parse((await t('get_block_for_figma', { id: 'b1' })).content[0].text).how_to.slice(0, 30));
  const c = JSON.parse((await t('get_block_for_figma', { id: 'c1' })).content[0].text);
  console.log('card', JSON.stringify(c.images.image.size_px), c.fields.filter((f: any) => f.kind === 'option').map((f: any) => f.key + '=' + f.value).join(' '), !!c.reference_image);
  console.log('view ref', (await t('view_image', { asset_id: 'c1', slot: 'reference' })).content[1].text);
  const pr = JSON.parse((await t('get_block_for_figma', { id: 'p1' })).content[0].text);
  console.log('product', pr.type, pr.fields.map((f: any) => f.key + '=' + f.value).join(' | '), pr.images.image.has_image, pr.images.image.url);
  console.log('image refused', (await t('get_block_for_figma', { id: 'a1' })).isError);
  const ga = JSON.parse((await t('get_asset', { id: 'a1' })).content[0].text);
  console.log('email', ga.image_url, ga.original_url, JSON.stringify(ga.email_ready));
  console.log('view email', (await t('view_image', { asset_id: 'a1' })).content[1].text);
  const rd = { id: 'd2', workspace_id: W1, kind: 'block', name: 'Read design', block_type: 'design', fields: { layout: 'left', headline: 'Essentials', cta: 'Buy now', style: { background: '#f4f1ec', font: 'serif', button_shape: 'underline' } }, images: { image: { path: 'w1/blocks/p.jpg', width: 400, height: 520 }, reference: { path: 'w1/d.jpg', width: 1200, height: 800 } } };
  assets.push(rd);
  const g = JSON.parse((await t('get_block_for_figma', { id: 'd2' })).content[0].text);
  console.log('read design', g.rebuild, g.style.font, g.fields.map((f: any) => f.key).join(','), g.how_to.slice(0, 30));
  const g1 = JSON.parse((await t('get_block_for_figma', { id: 'd1' })).content[0].text);
  console.log('unread design', g1.rebuild, g1.fields.map((f: any) => f.key).join(','));
  // ---- brand kit + origins ----
  console.log('no kit', JSON.parse((await t('get_brand_kit', { workspace_id: W1 })).content[0].text).status);
  console.log('kit other ws', (await t('get_brand_kit', { workspace_id: W2 })).isError);
  const sk = JSON.parse((await t('save_brand_kit', { workspace_id: W1, kit: { name: 'Acme', colors: { primary: '#E4002B', text: 'rgb(29,29,31)', background: '#fff', button_bg: '#e4002b', button_text: '#ffffff', link: 'not a colour' }, type: { heading: { family: '"Playfair Display", serif', weight: 700 }, body: { family: 'Inter', url: 'https://fonts.googleapis.com/css2?family=Inter' } }, logos: { primary: 'x1' } }, logo_url: 'https://cdn.figma-logo.com/logo.svg', source: { figma_url: 'https://www.figma.com/design/ABC/Acme-EDS' } })).content[0].text);
  console.log('save', sk.status, sk.version, sk.kit.colors.primary, sk.kit.colors.text, sk.kit.colors.background, sk.kit.colors.link, sk.kit.type.heading.family, '|', sk.kit.type.heading.fallback, '|', !!sk.kit.logos.primary, sk.notes.join(' '), 'missing:', sk.missing.join(', '));
  console.log('warn', sk.warnings.join(' / '));
  const sk2 = JSON.parse((await t('save_brand_kit', { workspace_id: W1, kit: { colors: { accent: '#ffcc00' } } })).content[0].text);
  console.log('merge keeps', sk2.version, sk2.kit.colors.primary, sk2.kit.colors.accent, !!sk2.kit.logos.primary);
  const gk = JSON.parse((await t('get_brand_kit', { workspace_id: W1 })).content[0].text);
  console.log('get kit', gk.status, gk.source.type, gk.font_stacks.heading, '|', gk.kit.logos.primary?.url?.slice(0, 20));
  const bad_logo = JSON.parse((await t('save_brand_kit', { workspace_id: W1, kit: {}, logo_url: 'https://x.com/not-image' })).content[0].text);
  console.log('bad logo', bad_logo.notes[0]);
  const gen = JSON.parse((await t('add_generated_asset', { workspace_id: W1, image_url: 'https://images.example.com/hero.png', name: 'Merino hero', prompt: 'Merino crew on oak table, warm light', model: 'nano-banana-2', source_product_pid: '10482', alt: 'Grey merino jumper' })).content[0].text);
  console.log('gen', gen.asset.origin, gen.asset.status, gen.asset.width + 'x' + gen.asset.height, gen.asset.provenance.source_product_pid, gen.asset.provenance.source_asset_ids.join(','), gen.asset.provenance.brand_kit_version, gen.asset.alt);
  console.log('gen http', (await t('add_generated_asset', { workspace_id: W1, image_url: 'http://images.example.com/x.png', name: 'x' })).isError, (await t('add_generated_asset', { workspace_id: W1, image_url: 'https://127.0.0.1/x.png', name: 'x' })).isError, (await t('add_generated_asset', { workspace_id: W1, image_url: 'https://x.com/not-image', name: 'x' })).isError);
  const fig = JSON.parse((await t('add_generated_asset', { workspace_id: W1, image_url: 'https://images.example.com/export.png', name: 'LinkedIn banner', model: 'Figma', figma_file_key: 'FILEKEY', figma_node_id: '12:34', source_asset_ids: ['a1'] })).content[0].text);
  console.log('figma save', fig.asset.origin, fig.asset.status, fig.asset.figma.node_id, fig.asset.provenance.source_asset_ids.join(','));
  console.log('drafts', JSON.parse((await t('list_assets', { status: 'draft' })).content[0].text).map((a: any) => a.name).join(','));
  console.log('ws kit', JSON.parse((await t('list_workspaces', {})).content[0].text)[0].brand_kit);
  console.log('bad origin', (await t('list_assets', { origin: 'x' })).isError);
  const bad: any = await call({ jsonrpc: '2.0', id: 9, method: 'nope' });
  console.log('unknown', bad.error.code);
  const batch: any = await call([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/x' }]);
  console.log('batch', JSON.stringify(batch));
})();
