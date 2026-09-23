// Emailsy CMS MCP server: a stateless JSON-RPC handler for the MCP "streamable HTTP"
// transport. Each POST carries one message (or a batch) and gets a JSON reply.
import { BLOCK_TYPES } from '../blockTypes';

export type Workspace = { id: string; name: string; role: string; figma_file_url?: string | null; figma_file_key?: string | null; figma_file_name?: string | null };
export type AssetRow = Record<string, any> & { id: string; workspace_id: string; kind: string; name: string };

// Data access the tools need. The real implementation uses Supabase (see repo.ts);
// tests pass an in-memory fake.
export interface Repo {
  workspacesForUser(userId: string): Promise<Workspace[]>;
  listAssets(workspaceIds: string[], opts: { kind?: string; query?: string; limit: number }): Promise<AssetRow[]>;
  getAsset(id: string): Promise<AssetRow | null>;
  signedUrl(path: string): Promise<string | null>;
  download(path: string): Promise<{ blob: Blob; mime: string } | null>;
  updateAsset(id: string, patch: Record<string, any>): Promise<void>;
}

export type Ctx = { repo: Repo; userId: string; fetchImpl?: typeof fetch };

export const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS = `Emailsy CMS holds a team's email-ready assets, grouped into brand workspaces: images, logos, products (from a feed, keyed by PID) and blocks (content shapes like Hero, Card, Product, Button and Footer, with copy and email-ready images, plus Design blocks: a finished design saved as one flat image).

Which Figma file: each workspace can have a connected Figma file (figma_file in list_workspaces and in asset results). When the user doesn't give a Figma link, use the connected file of the asset's workspace without asking. A link the user gives always wins. If there is neither, ask for a link once and suggest connecting a file in Emailsy (Workspace settings).

Putting an image into Figma (with the Figma MCP connected). The default is to ADD it to the canvas; only replace a layer if the user asks for that.
- Add to the canvas (default): call Figma's upload_assets with count 1 and NO nodeIds. Figma creates a new frame holding the image on the file's current page. Pass its submitUrl to push_image_to_figma. The Emailsy server uploads the full-size image. Then, if useful, move the new frame next to existing content with use_figma so it isn't hidden under other frames, and tell the user where it is.
- Replace a layer (only when the user says "replace", "swap" or "put it in/on this layer"): find the target first. Figma's get_metadata with no nodeId reports the user's current selection when the file is open in the Figma desktop app; otherwise use the layer name or link the user gave. Call upload_assets with count 1 and nodeIds [that node], then push_image_to_figma.
- Never refuse or stall because a selection isn't visible: fall back to adding to the canvas and say so.
- Never download images yourself or re-encode them; always use push_image_to_figma.

Turning a block into a component in the user's design system:
1. Call get_block_for_figma to get the copy, image slots and field rules.
2. Inspect the user's chosen Figma design-system file first (their styles, variables, components and naming). Build the component from their foundations, not from scratch styling.
3. Build it as a COMPONENT with auto layout, named layers, text properties for each text field, and the image slots as image-filled rectangles at the given sizes (push images with push_image_to_figma).
4. Call record_figma_placement with the file key and node id so the team can see it in Emailsy.

Rebuilding a Design block (block type "design", or any time the user says an image IS a finished design, e.g. a card with a photo and copy baked in):
The goal is an editable copy of that design, not the flat image with new copy next to it. Never place the whole flat image and never add default or placeholder copy.
1. Call get_block_for_figma, then view_image on the block to SEE the design. Read every piece of text exactly as written (headlines, quotes, names, prices, button labels), and note the layout: where the photo sits, columns, alignment, spacing, colours, font sizes and weights, dividers, icons such as star ratings, and the background colour.
2. Work out the photo region(s) as pixel boxes on the image you viewed (x, y, width, height). A photo region holds only the photo, never text.
3. In Figma, build ONE component that recreates the layout with auto layout, sized to the design's width in CSS px (image width / 2). Photo regions become rectangles; text becomes live text layers with component text properties; star ratings and simple icons become vectors or characters; solid backgrounds become fills. Use the design system's text styles and colours when they match closely; otherwise match the design's own values.
4. Photos: call Figma's upload_assets with count 1 and push_image_to_figma for this block with original: false. That uploads the whole design image once. Apply its imageHash to each photo rectangle as an IMAGE fill with scaleMode "CROP" and imageTransform [[w/W, 0, x/W], [0, h/H, y/H]], where (x, y, w, h) is the photo box and (W, H) is the full image size from view_image. Delete the frame upload_assets created once the fills are in place.
5. Compare your build with get_screenshot against the design and fix differences in layout, text, sizes and colours. Then call record_figma_placement.
If the text is too small to read, say so and ask the user for the copy rather than guessing.`;

function text(data: unknown) {
  return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] };
}
function toolError(message: string) {
  return { content: [{ type: 'text', text: message }], isError: true };
}

const TOOLS = [
  {
    name: 'list_workspaces',
    description: 'List the brand workspaces this user can see, with how many images, logos, products and blocks each holds.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_assets',
    description: 'List assets. Filter by workspace, kind (image, logo, product, block) and a search over names and product IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string', description: 'Workspace id from list_workspaces. Omit to search all.' },
        kind: { type: 'string', enum: ['image', 'logo', 'product', 'block'] },
        query: { type: 'string', description: 'Matches asset names and product IDs.' },
        limit: { type: 'number', minimum: 1, maximum: 200, default: 50 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'get_asset',
    description: 'Get one asset with its details and a temporary image URL (valid for one hour). For blocks, returns every field and image slot.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'search_products',
    description: 'Find products by name or PID across the user\'s workspaces.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, workspace_id: { type: 'string' }, limit: { type: 'number', default: 20 } },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_block_for_figma',
    description: 'Everything needed to build a block as a Figma component: its type, copy, link, image slots (size, fit, alt text) and field rules such as character limits.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
  },
  {
    name: 'push_image_to_figma',
    description: 'Upload an asset\'s full-size image straight from Emailsy to Figma. First call Figma\'s upload_assets with count 1: without nodeIds to add the image to the canvas as a new frame (the default), or with nodeIds [layer] to fill an existing layer. Pass its submitUrl here. For a block, name the image slot (e.g. "image" or "logo"). Returns Figma\'s response including the imageHash and where the image was placed.',
    inputSchema: {
      type: 'object',
      properties: {
        asset_id: { type: 'string' },
        upload_url: { type: 'string', description: 'The submitUrl returned by Figma\'s upload_assets.' },
        slot: { type: 'string', description: 'Block image slot. Defaults to the first image slot.' },
        original: { type: 'boolean', description: 'For blocks: send the original upload instead of the email-ready crop.' },
      },
      required: ['asset_id', 'upload_url'],
      additionalProperties: false,
    },
  },
  {
    name: 'view_image',
    description: 'Look at an asset\'s image or a block\'s image slot. Returns the image itself so you can read the text and layout of a finished design. Use it before rebuilding a Design block in Figma.',
    inputSchema: {
      type: 'object',
      properties: {
        asset_id: { type: 'string' },
        slot: { type: 'string', description: 'Block image slot. Defaults to the first image slot.' },
        original: { type: 'boolean', description: 'For blocks: view the original upload instead of the email-ready version.' },
      },
      required: ['asset_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'record_figma_placement',
    description: 'Record where an asset or block now lives in Figma, so the team can see it in Emailsy.',
    inputSchema: {
      type: 'object',
      properties: {
        asset_id: { type: 'string' },
        file_key: { type: 'string' },
        node_id: { type: 'string' },
        component_key: { type: 'string' },
        note: { type: 'string' },
      },
      required: ['asset_id', 'file_key', 'node_id'],
      additionalProperties: false,
    },
  },
];

function figmaFile(w?: Workspace) {
  return w?.figma_file_key ? { file_key: w.figma_file_key, url: w.figma_file_url, name: w.figma_file_name || null } : null;
}

function publicAsset(a: AssetRow, ws?: Workspace) {
  const wsName = ws?.name;
  const out: Record<string, any> = {
    id: a.id,
    kind: a.kind,
    name: a.name,
    workspace_id: a.workspace_id,
    workspace: wsName,
    updated_at: a.updated_at,
  };
  if (a.width) Object.assign(out, { width: a.width, height: a.height });
  if (a.kind === 'product') Object.assign(out, { pid: a.pid, price: a.price, link: a.link, has_image: !!a.storage_path });
  if (a.kind === 'block') Object.assign(out, { block_type: a.block_type, block_type_name: BLOCK_TYPES[a.block_type]?.name });
  if (a.figma) out.figma = a.figma;
  if (ws) out.workspace_figma_file = figmaFile(ws);
  return out;
}

async function allowedAsset(ctx: Ctx, id: string) {
  if (!id || typeof id !== 'string') return { error: 'Pass an asset id.' };
  const ws = await ctx.repo.workspacesForUser(ctx.userId);
  const a = await ctx.repo.getAsset(id);
  if (!a || !ws.some((w) => w.id === a.workspace_id)) return { error: `No asset with id ${id} in your workspaces.` };
  return { asset: a, ws };
}

// Storage path of an asset's image, or of one of a block's image slots.
function imagePath(a: AssetRow, slotArg?: string, original?: boolean): { path?: string | null; error?: string; width?: number; height?: number } {
  if (a.kind !== 'block') return { path: a.storage_path || null, width: a.width, height: a.height };
  const slots = BLOCK_TYPES[a.block_type]?.fields.filter((f) => f.type === 'image').map((f) => f.k) || [];
  const key = slotArg || slots[0];
  const slot = a.images?.[key];
  if (!slot) return { error: `Block has no image in slot "${key}". Slots: ${slots.join(', ') || 'none'}.` };
  if (original && slot.original_path) return { path: slot.original_path };
  return { path: slot.path, width: slot.width, height: slot.height };
}

async function blockImages(ctx: Ctx, a: AssetRow) {
  const out: Record<string, any> = {};
  const spec = BLOCK_TYPES[a.block_type];
  for (const f of spec?.fields.filter((f) => f.type === 'image') || []) {
    const slot = a.images?.[f.k];
    const ew = f.natural ? slot?.width || null : (f.w || 0) * 2;
    const eh = f.natural ? slot?.height || null : (f.h || 0) * 2;
    out[f.k] = {
      label: f.label,
      size_px: { width: ew ? Math.round(ew / 2) : f.w, height: eh ? Math.round(eh / 2) : null },
      export_px: { width: ew, height: eh },
      keeps_shape: !!f.natural,
      fit: f.fit,
      format: f.png ? 'png' : 'jpg',
      alt: slot?.alt || '',
      has_image: !!slot?.path,
      url: slot?.path ? await ctx.repo.signedUrl(slot.path) : null,
    };
  }
  return out;
}

export async function callTool(name: string, args: Record<string, any>, ctx: Ctx) {
  args = args || {};
  switch (name) {
    case 'list_workspaces': {
      const ws = await ctx.repo.workspacesForUser(ctx.userId);
      const assets = ws.length ? await ctx.repo.listAssets(ws.map((w) => w.id), { limit: 5000 }) : [];
      return text(
        ws.map((w) => {
          const mine = assets.filter((a) => a.workspace_id === w.id);
          const count = (k: string) => mine.filter((a) => a.kind === k).length;
          return { id: w.id, name: w.name, role: w.role, figma_file: figmaFile(w), images: count('image'), logos: count('logo'), products: count('product'), blocks: count('block') };
        }),
      );
    }
    case 'list_assets':
    case 'search_products': {
      const ws = await ctx.repo.workspacesForUser(ctx.userId);
      let ids = ws.map((w) => w.id);
      if (args.workspace_id) {
        if (!ids.includes(args.workspace_id)) return toolError('That workspace is not one of yours. Call list_workspaces for valid ids.');
        ids = [args.workspace_id];
      }
      if (!ids.length) return text([]);
      const kind = name === 'search_products' ? 'product' : args.kind;
      if (kind && !['image', 'logo', 'product', 'block'].includes(kind)) return toolError('kind must be image, logo, product or block.');
      const limit = Math.min(Math.max(Number(args.limit) || (name === 'search_products' ? 20 : 50), 1), 200);
      const rows = await ctx.repo.listAssets(ids, { kind, query: args.query ? String(args.query) : undefined, limit });
      const byId = Object.fromEntries(ws.map((w) => [w.id, w]));
      return text(rows.map((a) => publicAsset(a, byId[a.workspace_id])));
    }
    case 'get_asset': {
      const r = await allowedAsset(ctx, args.id);
      if (r.error) return toolError(r.error);
      const a = r.asset!;
      const out = publicAsset(a, r.ws!.find((w) => w.id === a.workspace_id));
      if (a.storage_path) out.image_url = await ctx.repo.signedUrl(a.storage_path);
      if (a.focus) out.focus = a.focus;
      if (a.kind === 'block') {
        out.fields = a.fields || {};
        out.images = await blockImages(ctx, a);
      }
      return text(out);
    }
    case 'get_block_for_figma': {
      const r = await allowedAsset(ctx, args.id);
      if (r.error) return toolError(r.error);
      const a = r.asset!;
      if (a.kind !== 'block') return toolError(`"${a.name}" is a ${a.kind}, not a block. Use get_asset instead.`);
      const spec = BLOCK_TYPES[a.block_type];
      if (!spec) return toolError(`Unknown block type "${a.block_type}".`);
      return text({
        id: a.id,
        name: a.name,
        type: a.block_type,
        type_name: spec.name,
        description: spec.note,
        component_name_suggestion: `${spec.name} / ${a.name}`,
        fields: spec.fields
          .filter((f) => f.type !== 'image')
          .map((f) => ({ key: f.k, label: f.label, kind: f.type === 'url' ? 'link' : 'text', max_chars: f.max || null, link_for: f.linkOf || null, value: a.fields?.[f.k] || '' })),
        images: await blockImages(ctx, a),
        figma: a.figma || null,
        workspace_figma_file: figmaFile(r.ws!.find((w) => w.id === a.workspace_id)),
        rebuild: a.block_type === 'design',
        how_to: a.block_type === 'design'
          ? 'This is a finished design saved as one flat image. Do NOT place the flat image or add placeholder copy. Call view_image on this block, read the exact text and layout, then rebuild it as one component: photo regions as image-filled rectangles cropped from the pushed image (scaleMode CROP), all text as live text with component text properties, laid out as in the design. Follow "Rebuilding a Design block" in the server instructions. Use the notes field if the user left any.'
          : 'Build from the target design system\'s own text styles, colours and spacing. One COMPONENT, vertical auto layout, hug height. Expose each text field as a component text property. Push each image with push_image_to_figma, then apply the returned imageHash as an IMAGE fill (scaleMode FILL for cover, FIT for contain) on a rectangle at size_px.',
      });
    }
    case 'view_image': {
      const r = await allowedAsset(ctx, args.asset_id);
      if (r.error) return toolError(r.error);
      const a = r.asset!;
      const p = imagePath(a, args.slot, !!args.original);
      if (p.error) return toolError(p.error);
      if (!p.path) return toolError(`"${a.name}" has no image yet.`);
      const file = await ctx.repo.download(p.path);
      if (!file) return toolError('Could not read the image from storage.');
      if (file.blob.size > 4_500_000) return toolError('That image is over 4.5 MB, too large to view. Try without original: true to view the email-ready version.');
      const mime = /png|jpeg|jpg|gif|webp/.test(file.mime) ? file.mime.replace('jpg', 'jpeg') : 'image/jpeg';
      const data = Buffer.from(await file.blob.arrayBuffer()).toString('base64');
      const size = p.width && p.height ? `${p.width}×${p.height}px` : 'size unknown';
      return {
        content: [
          { type: 'image', data, mimeType: mime },
          { type: 'text', text: `"${a.name}" (${size}). Pixel boxes you measure on this image map to CSS px at half size (images are exported at 2x).` },
        ],
      };
    }
    case 'push_image_to_figma': {
      const r = await allowedAsset(ctx, args.asset_id);
      if (r.error) return toolError(r.error);
      const a = r.asset!;
      let url: URL;
      try {
        url = new URL(String(args.upload_url));
      } catch {
        return toolError('upload_url is not a valid URL. Pass the submitUrl from Figma\'s upload_assets.');
      }
      const host = url.hostname.toLowerCase();
      if (url.protocol !== 'https:' || !(host === 'figma.com' || host.endsWith('.figma.com'))) {
        return toolError('upload_url must be an https figma.com address from Figma\'s upload_assets.');
      }
      const p = imagePath(a, args.slot, !!args.original);
      if (p.error) return toolError(p.error);
      const path = p.path;
      if (!path) return toolError(`"${a.name}" has no image yet.`);
      const file = await ctx.repo.download(path);
      if (!file) return toolError('Could not read the image from storage.');
      const ext = file.mime.includes('png') ? 'png' : file.mime.includes('webp') ? 'webp' : file.mime.includes('gif') ? 'gif' : 'jpg';
      const safe = a.name.replace(/[^\w.-]+/g, '-').slice(0, 60) || 'image';
      const form = new FormData();
      form.append('file', new Blob([await file.blob.arrayBuffer()], { type: file.mime }), `${safe}.${ext}`);
      const res = await (ctx.fetchImpl || fetch)(url.toString(), { method: 'POST', body: form });
      const bodyText = await res.text();
      let body: any = bodyText;
      try { body = JSON.parse(bodyText); } catch {}
      if (!res.ok) return toolError(`Figma rejected the upload (${res.status}): ${bodyText.slice(0, 500)}`);
      return text({ ok: true, uploaded: `${safe}.${ext}`, bytes: file.blob.size, figma: body });
    }
    case 'record_figma_placement': {
      const r = await allowedAsset(ctx, args.asset_id);
      if (r.error) return toolError(r.error);
      const figma = {
        file_key: String(args.file_key),
        node_id: String(args.node_id),
        component_key: args.component_key ? String(args.component_key) : null,
        note: args.note ? String(args.note).slice(0, 300) : null,
        placed_at: new Date().toISOString(),
      };
      await ctx.repo.updateAsset(r.asset!.id, { figma });
      return text({ ok: true, figma });
    }
    default:
      return null;
  }
}

type RpcMessage = { jsonrpc: '2.0'; id?: string | number | null; method?: string; params?: any };

export async function handleMessage(msg: RpcMessage, ctx: Ctx): Promise<object | null> {
  const isRequest = msg && msg.id !== undefined && msg.id !== null;
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    return isRequest ? { jsonrpc: '2.0', id: msg.id, error: { code: -32600, message: 'Invalid request' } } : null;
  }
  if (!isRequest) return null; // notifications (e.g. notifications/initialized) need no reply
  const reply = (result: object) => ({ jsonrpc: '2.0', id: msg.id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: msg.id, error: { code, message } });
  try {
    switch (msg.method) {
      case 'initialize': {
        const asked = msg.params?.protocolVersion;
        return reply({
          protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'emailsy-cms', title: 'Emailsy CMS', version: '0.1.0' },
          instructions: INSTRUCTIONS,
        });
      }
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({ tools: TOOLS });
      case 'tools/call': {
        const name = msg.params?.name;
        const result = await callTool(name, msg.params?.arguments || {}, ctx);
        if (!result) return fail(-32602, `Unknown tool: ${name}`);
        return reply(result);
      }
      case 'resources/list':
        return reply({ resources: [] });
      case 'prompts/list':
        return reply({ prompts: [] });
      default:
        return fail(-32601, `Method not found: ${msg.method}`);
    }
  } catch (err: any) {
    return reply(toolError(`Something went wrong: ${err?.message || err}`));
  }
}

export async function handleBody(body: unknown, ctx: Ctx) {
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handleMessage(m, ctx)))).filter(Boolean);
    return out.length ? out : null;
  }
  return handleMessage(body as RpcMessage, ctx);
}
