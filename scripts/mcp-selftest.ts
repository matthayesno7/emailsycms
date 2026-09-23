// Self-test for the MCP handler with an in-memory fake database.
// Run: npx tsx scripts/mcp-selftest.ts
import { handleBody } from '../lib/mcp/server';
const W1 = 'w1', W2 = 'w2';
const assets: any[] = [
  { id: 'a1', workspace_id: W1, kind: 'image', name: 'Autumn hero', storage_path: 'w1/a.jpg', width: 1600, height: 900 },
  { id: 'p1', workspace_id: W1, kind: 'product', name: 'Merino crew', pid: '10482', price: '£48', storage_path: 'w1/p.png' },
  { id: 'b1', workspace_id: W1, kind: 'block', name: 'Autumn block', block_type: 'hero', fields: { headline: 'Hi', cta: 'Shop', link: 'https://x' }, images: { image: { path: 'w1/blocks/b.jpg', alt: 'Sunset', original_path: 'w1/a.jpg' } } },
  { id: 'x1', workspace_id: W2, kind: 'image', name: 'Secret', storage_path: 'w2/s.jpg' },
];
const repo = {
  async workspacesForUser() { return [{ id: W1, name: 'My brand', role: 'owner' }]; },
  async listAssets(ids: string[], o: any) { return assets.filter(a => ids.includes(a.workspace_id) && (!o.kind || a.kind === o.kind) && (!o.query || (a.name + (a.pid||'')).toLowerCase().includes(o.query.toLowerCase()))).slice(0, o.limit); },
  async getAsset(id: string) { return assets.find(a => a.id === id) || null; },
  async signedUrl(p: string) { return 'https://signed/' + p; },
  async download(p: string) { return { blob: new Blob([new Uint8Array([1,2,3])], { type: p.endsWith('png') ? 'image/png' : 'image/jpeg' }), mime: p.endsWith('png') ? 'image/png' : 'image/jpeg' }; },
  async updateAsset(id: string, patch: any) { Object.assign(assets.find(a => a.id === id), patch); },
};
let posted: any = null;
const fetchImpl: any = async (url: string, init: any) => { posted = { url, file: init.body.get('file') }; return new Response(JSON.stringify({ imageHash: 'abc123' }), { status: 200 }); };
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
  const bad: any = await call({ jsonrpc: '2.0', id: 9, method: 'nope' });
  console.log('unknown', bad.error.code);
  const batch: any = await call([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/x' }]);
  console.log('batch', JSON.stringify(batch));
})();
