// Emailsy CMS MCP server: a stateless JSON-RPC handler for the MCP "streamable HTTP"
// transport. Each POST carries one message (or a batch) and gets a JSON reply.
import { BLOCK_TYPES, isReadDesign } from '../blockTypes';
import { productAsBlock } from '../products';
import { mergeKit, missing, normaliseKit, warnings } from '../brandKit';
import { fetchLimited, IMAGE_EXT } from '../net';
import { imageSize } from '../imageSize';
import { PROMPTS, fillPrompt, USE_LABEL } from '../prompts';

export type Workspace = { id: string; name: string; role: string; figma_file_url?: string | null; figma_file_key?: string | null; figma_file_name?: string | null };
export type AssetRow = Record<string, any> & { id: string; workspace_id: string; kind: string; name: string };

// Data access the tools need. The real implementation uses Supabase (see repo.ts);
// tests pass an in-memory fake.
export interface Repo {
  workspacesForUser(userId: string): Promise<Workspace[]>;
  listAssets(workspaceIds: string[], opts: { kind?: string; origin?: string; status?: string; query?: string; limit: number }): Promise<AssetRow[]>;
  getAsset(id: string): Promise<AssetRow | null>;
  signedUrl(path: string): Promise<string | null>;
  download(path: string): Promise<{ blob: Blob; mime: string } | null>;
  updateAsset(id: string, patch: Record<string, any>): Promise<void>;
  insertAsset(row: Record<string, any>): Promise<AssetRow>;
  upload(path: string, buf: Buffer, type: string): Promise<void>;
  getBrandKit(workspaceId: string): Promise<Record<string, any> | null>;
  saveBrandKit(row: Record<string, any>): Promise<Record<string, any>>;
}

export type Ctx = { repo: Repo; userId: string; fetchImpl?: typeof fetch };

export const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS = `Emailsy is the brand's creative library for Claude: its brand kit, logos, images, product feed and email blocks, plus everything made with Claude. Work from these, make things in Figma, and save what you make back here.

Brand kit: each workspace has one brand kit: colours by role, fonts with email-safe fallbacks, button style, content width, logos, imagery style and voice. Call get_brand_kit before building or generating anything for a workspace and follow it; never guess colours or fonts the kit gives you. A draft kit hasn't been approved by the team yet: use it, but mention that.

Creating a brand kit from a Figma email design system (the user asks to set up, build or import their brand kit from Figma):
1. Read the file with the Figma connector: get_variable_defs for colour and number variables, search_design_system or get_metadata for text styles and the button component, and get_screenshot of the foundations page or a finished email.
2. Map to roles: primary (the signature brand colour), secondary, accent, text, text_muted, background, surface, border, link, button_bg, button_text. Heading and body fonts: family, weight and sizes in px at email scale (if the file is drawn at 2x, halve the sizes). Button: style (filled, outline, underline), radius, padding, weight, case. Content width (usually 600-640).
3. Logo: if the file has a logo, export it with Figma's download_assets (SVG preferred) and pass the https URL as logo_url, or pass an Emailsy logo asset id in kit.logos.primary.
4. Call save_brand_kit with source.figma_url. It is saved as a draft that the team reviews and approves in Emailsy (Brand kit). Tell the user what you filled in and what the tool reports as missing or worth checking.
Never invent values: leave a role empty rather than guess. Email Love design systems keep their foundations in variables (colour/brand/*, typography/*); treat those names as the strongest signal.
Building from a website instead happens in Emailsy itself (Brand kit → From your website); suggest that when the user has no design system.

Where assets come from: each asset has an origin: uploaded (added by the team), product_feed (from the product feed, keyed by PID) or generated (made by AI), and a status: approved or draft. Generated assets start as drafts and carry provenance (prompt, model, source product). Images you create for a workspace go into the library with add_generated_asset; a person approves them in Emailsy, so never describe a draft as approved. Prefer approved assets when building emails; use drafts only when the user asks for them.

Making things (Emailsy holds the brand and the source assets; the Figma connector does the making):
- Designs (banners, social posts, ads, slides): build them in Figma from the brand kit and Emailsy assets (push_image_to_figma), headline as live text, then save the finished frame with add_generated_asset.
- New imagery (a product in a new scene, a seasonal backdrop, a cut-out): use Figma's Weave models. weave_find_model (e.g. "nano banana 2" for images), pass the product photo's image_url from get_asset as the reference image, and describe the scene using the brand kit's imagery.style and do/don't rules. Never alter the product itself: say so in the prompt, and prefer compositing the real cut-out over a generated scene in Figma when the product must be exact. Weave runs cost the user credits: always quote the cost and get an explicit yes before running.
- Video: either a Weave video model (e.g. "veo 3") from a product image, or animate a Figma frame and export it with export_video (MP4). Save the MP4 with add_generated_asset (kind video).
- Always finish by saving the result to Emailsy with add_generated_asset, then tell the user it's waiting for approval there.
The user can pick ready-made requests from this server's prompts (the Emailsy prompt library). A request may contain a blank like [product] or [image]: find the best candidates in Emailsy (search_products, list_assets) and ask the user to pick, showing a few options, rather than guessing.

Designs made in Emailsy Studio (provenance.via "studio") carry their layout in provenance.spec: layers with x, y, w, h as percentages of the canvas (provenance.size), text sizes as a percentage of the canvas width, and colours as brand kit roles. To rebuild one in Figma: make a frame at provenance.size, map each layer to a Figma layer (images via push_image_to_figma with the layer's asset id, rectangles with the role's brand kit colour, text as live text in the kit's fonts, the button in the kit's button style), then save it back with add_generated_asset if the user changed it.

Saving something you designed in Figma back into Emailsy (a banner, a social image, a finished email section): call Figma's download_assets on the finished frame, take its export URL (a temporary https link) and pass it straight to add_generated_asset as image_url, with figma_file_key and figma_node_id, the Emailsy asset ids you used in source_asset_ids, and a short description of the brief as prompt. Do it as the last step whenever you make a finished image for a workspace, without being asked, and tell the user it's waiting for approval in Emailsy. Never tell the user to export and upload by hand.

What each kind of asset becomes in Figma:
- image and logo: stay images. Place them with push_image_to_figma; never add text to them.
- block: an image plus copy. Build it as a component with the copy as live, editable text (get_block_for_figma).
- Use an asset's alt text (alt, when present) as the image's alt text in the email.
- Assets (images, logos, products) are the source material. Blocks are email modules built from assets; a block references its assets and never replaces them.
- product: a card built from the product feed: image, label, name, description, price and button. Build it like a Product block with live text (get_block_for_figma works on products too). Leave out any part whose value is empty (e.g. no button if cta is empty).

Emailsy CMS holds a team's email-ready assets, grouped into brand workspaces: images, logos, products (from a feed, keyed by PID) and blocks (content shapes like Hero, Card, Product, Button and Footer, with copy and email-ready images, plus Design blocks: a finished design saved as one flat image).

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

Card blocks can have layout "top", "left" or "right" (image beside the copy), a sub header (eyebrow), a star rating and a name. Cards read from a finished design keep that design as images.reference: view it with view_image slot "reference" to match the layout.

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
    description: 'List the brand workspaces this user can see, with their brand kit status, connected Figma file, and how many images, logos, products, blocks and drafts each holds.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_assets',
    description: 'List assets. Filter by workspace, kind (image, logo, product, block), origin (uploaded, product_feed, generated), status (approved, draft) and a search over names and product IDs.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string', description: 'Workspace id from list_workspaces. Omit to search all.' },
        kind: { type: 'string', enum: ['image', 'logo', 'video', 'product', 'block'] },
        origin: { type: 'string', enum: ['uploaded', 'product_feed', 'generated'], description: 'Where the asset came from.' },
        status: { type: 'string', enum: ['approved', 'draft'], description: 'Generated assets start as drafts until a person approves them.' },
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
    description: 'Works on blocks and products. Everything needed to build one as a Figma component: its type, copy, link, image slots (size, fit, alt text) and field rules such as character limits.',
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
        original: { type: 'boolean', description: 'Send the original upload instead of the email-ready version (the default).' },
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
  {
    name: 'get_brand_kit',
    description: 'The workspace\'s brand kit: colours by role (hex), heading and body fonts with web font links and email-safe fallbacks, sizes, button style, content width, logos (with temporary URLs), imagery style and do/don\'t rules, and voice. Also its status (draft or approved), what is missing and anything worth checking. Call this before building or generating anything for a workspace.',
    inputSchema: { type: 'object', properties: { workspace_id: { type: 'string' } }, required: ['workspace_id'], additionalProperties: false },
  },
  {
    name: 'save_brand_kit',
    description: 'Create or update a workspace\'s brand kit, e.g. from a Figma email design system. Saved as a draft for the team to approve in Emailsy. mode "merge" (default) fills and updates only the values you pass; "replace" starts from empty. Colours are #rrggbb. Logo: pass logo_url (an https image URL such as Figma download_assets output) to import it, or kit.logos.primary with an Emailsy logo asset id.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        kit: {
          type: 'object',
          description: 'Any of: name, colors {primary, secondary, accent, text, text_muted, background, surface, border, link, button_bg, button_text}, dark {background, surface, text, link}, type {heading {family, weight, url, fallback}, body {…}, sizes {h1, h2, body, small}, heading_case none|upper|title}, button {style filled|outline|underline, radius, padding_y, padding_x, weight, case}, layout {width, radius, spacing}, imagery {style, do[], dont[]}, voice {tone[], samples[]}, logos {primary, reversed, icon}, notes.',
        },
        logo_url: { type: 'string', description: 'https URL of the primary logo to import into the workspace\'s Logos.' },
        source: { type: 'object', properties: { figma_url: { type: 'string' }, file_key: { type: 'string' } }, additionalProperties: false },
        mode: { type: 'string', enum: ['merge', 'replace'], default: 'merge' },
      },
      required: ['workspace_id', 'kit'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_generated_asset',
    description: 'Save a finished image you made into a workspace\'s library as a draft, with where it came from: a design you built in Figma (pass the export URL from Figma\'s download_assets), or an image from an image model. Pass an https URL of the image; the Emailsy server downloads it, so the file never passes through you. A person approves it in Emailsy.',
    inputSchema: {
      type: 'object',
      properties: {
        workspace_id: { type: 'string' },
        image_url: { type: 'string', description: 'https URL of the file: PNG, JPEG, WebP or GIF image, or MP4/WebM video.' },
        name: { type: 'string' },
        kind: { type: 'string', enum: ['image', 'logo', 'video'], default: 'image', description: 'video for MP4/WebM files (e.g. from export_video or a Weave video model).' },
        alt: { type: 'string', description: 'Alt text for email.' },
        prompt: { type: 'string', description: 'The prompt or brief used to make it.' },
        model: { type: 'string', description: 'The model or tool that made it, e.g. "Figma" for a design you built there.' },
        source_product_pid: { type: 'string', description: 'PID of the product it was made from, if any.' },
        source_asset_ids: { type: 'array', items: { type: 'string' }, description: 'Emailsy assets used as inputs (product photo, reference images).' },
        style: { type: 'string', description: 'Short style label, e.g. "studio, warm light".' },
        figma_file_key: { type: 'string', description: 'If it was designed in Figma: the file key.' },
        figma_node_id: { type: 'string', description: 'If it was designed in Figma: the frame\'s node id.' },
      },
      required: ['workspace_id', 'image_url', 'name'],
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
    origin: a.origin || (a.kind === 'product' ? 'product_feed' : 'uploaded'),
    status: a.status || 'approved',
    updated_at: a.updated_at,
  };
  if (a.origin === 'generated' && a.provenance) out.provenance = a.provenance;
  if (a.width) Object.assign(out, { width: a.width, height: a.height });
  if (a.fields?.alt) out.alt = a.fields.alt;
  if (a.kind === 'product') Object.assign(out, { pid: a.pid, price: a.price, link: a.link, description: a.fields?.description || '', has_image: !!a.storage_path });
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
  if (a.kind !== 'block') {
    // Images default to their email-ready copy (max 1200px wide, compressed).
    const e = a.images?.email;
    if (e?.path && !original) return { path: e.path, width: e.width, height: e.height };
    return { path: a.storage_path || null, width: a.width, height: a.height };
  }
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
    const sideways = f.side && ['left', 'right'].includes(a.fields?.layout);
    const ew = f.natural ? slot?.width || null : sideways ? f.side!.w * 2 : (f.w || 0) * 2;
    const eh = f.natural ? slot?.height || null : sideways ? f.side!.h * 2 : (f.h || 0) * 2;
    out[f.k] = {
      label: f.label,
      size_px: { width: ew ? Math.round(ew / 2) : f.w || null, height: eh ? Math.round(eh / 2) : null },
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
      const kits: Record<string, string> = {};
      for (const w of ws) { const k = await ctx.repo.getBrandKit(w.id); if (k) kits[w.id] = k.status; }
      return text(
        ws.map((w) => {
          const mine = assets.filter((a) => a.workspace_id === w.id);
          const count = (k: string) => mine.filter((a) => a.kind === k).length;
          return { id: w.id, name: w.name, role: w.role, figma_file: figmaFile(w), brand_kit: kits[w.id] || 'none', images: count('image'), logos: count('logo'), videos: count('video'), products: count('product'), blocks: count('block'), drafts: mine.filter((a) => a.status === 'draft').length };
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
      if (kind && !['image', 'logo', 'video', 'product', 'block'].includes(kind)) return toolError('kind must be image, logo, video, product or block.');
      const limit = Math.min(Math.max(Number(args.limit) || (name === 'search_products' ? 20 : 50), 1), 200);
      if (args.origin && !['uploaded', 'product_feed', 'generated'].includes(args.origin)) return toolError('origin must be uploaded, product_feed or generated.');
      if (args.status && !['approved', 'draft'].includes(args.status)) return toolError('status must be approved or draft.');
      const rows = await ctx.repo.listAssets(ids, { kind, origin: args.origin, status: args.status, query: args.query ? String(args.query) : undefined, limit });
      const byId = Object.fromEntries(ws.map((w) => [w.id, w]));
      return text(rows.map((a) => publicAsset(a, byId[a.workspace_id])));
    }
    case 'get_asset': {
      const r = await allowedAsset(ctx, args.id);
      if (r.error) return toolError(r.error);
      const a = r.asset!;
      const out = publicAsset(a, r.ws!.find((w) => w.id === a.workspace_id));
      if (a.images?.email?.path) {
        out.image_url = await ctx.repo.signedUrl(a.images.email.path);
        out.email_ready = { width: a.images.email.width, height: a.images.email.height, bytes: a.images.email.bytes };
        if (a.storage_path) out.original_url = await ctx.repo.signedUrl(a.storage_path);
      } else if (a.storage_path) out.image_url = await ctx.repo.signedUrl(a.storage_path);
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
      // Products build like Product blocks: the feed fills the copy.
      const a = r.asset!.kind === 'product' ? { ...r.asset!, ...productAsBlock(r.asset! as any), kind: 'product' } : r.asset!;
      if (a.kind !== 'block' && a.kind !== 'product') return toolError(`"${a.name}" is a ${a.kind}: it stays an image. Use push_image_to_figma to place it.`);
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
          .filter((f) => f.type !== 'image' && !(a.block_type === 'design' && !isReadDesign(a) && !['notes', 'link'].includes(f.k)))
          .map((f) => ({ key: f.k, label: f.label, kind: f.type === 'url' ? 'link' : f.type === 'choice' ? 'option' : 'text', max_chars: f.max || null, link_for: f.linkOf || null, options: f.options ? f.options.map(([v]) => v) : undefined, value: a.fields?.[f.k] || '' })),
        images: await blockImages(ctx, a),
        figma: a.figma || null,
        workspace_figma_file: figmaFile(r.ws!.find((w) => w.id === a.workspace_id)),
        reference_image: a.images?.reference?.path
          ? { width: a.images.reference.width || null, height: a.images.reference.height || null, note: 'The original finished design this block was read from. Call view_image with slot "reference" to see it, and match its layout and proportions using the design system\'s styles.' }
          : null,
        style: a.fields?.style || null,
        rebuild: a.block_type === 'design' && !isReadDesign(a),
        how_to: isReadDesign(a)
          ? 'A finished design whose copy, photo and look have already been read out. Build ONE component that looks like the original: use the fields as live text (component text properties), the "image" slot as the photo (IMAGE fill, its own proportions), and follow style exactly: background colour, headline/text/accent colours (hex), serif or sans typeface (pick the closest font in the file), alignment, headline case, weight and tracking, and button shape and colours. layout top/left/right places the photo; style.photo_share is the photo\'s share of the width. Leave out empty fields. Call view_image with slot "reference" to compare your build with the original, and fix differences.'
          : a.block_type === 'design'
          ? 'This is a finished design saved as one flat image. Do NOT place the flat image or add placeholder copy. Call view_image on this block, read the exact text and layout, then rebuild it as one component: photo regions as image-filled rectangles cropped from the pushed image (scaleMode CROP), all text as live text with component text properties, laid out as in the design. Follow "Rebuilding a Design block" in the server instructions. Use the notes field if the user left any.'
          : 'Build from the target design system\'s own text styles, colours and spacing. One COMPONENT, vertical auto layout, hug height. Expose each text field as a component text property. Push each image with push_image_to_figma, then apply the returned imageHash as an IMAGE fill (scaleMode FILL for cover, FIT for contain) on a rectangle at size_px. Card layout: "top" = image above the copy (vertical auto layout); "left"/"right" = image beside the copy (horizontal auto layout, copy vertically centred). rating is a number of stars (draw that many star characters or vectors); leave out any field whose value is empty. Add a variant or boolean property for optional parts (stars, name, button) when the design system does that.',
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
    case 'get_brand_kit': {
      const w = await ownWorkspace(ctx, args.workspace_id);
      if ('error' in w) return toolError(w.error);
      const row = await ctx.repo.getBrandKit(w.ws.id);
      if (!row) return text({ workspace: w.ws.name, status: 'none', kit: null, how_to: 'No brand kit yet. Build one from the brand\'s Figma email design system with save_brand_kit (see the server instructions), or ask the user to build it from their website in Emailsy → Brand kit.' });
      const kit = normaliseKit(row.kit, w.ws.name);
      const logos: Record<string, any> = {};
      for (const [role, id] of Object.entries(kit.logos)) {
        if (!id) continue;
        const a = await ctx.repo.getAsset(id);
        if (a && a.workspace_id === w.ws.id) logos[role] = { asset_id: a.id, name: a.name, mime: a.mime, url: a.storage_path ? await ctx.repo.signedUrl(a.storage_path) : null };
      }
      const references: { asset_id: string; name: string }[] = [];
      for (const id of kit.imagery.references) {
        const a = await ctx.repo.getAsset(id);
        if (a && a.workspace_id === w.ws.id) references.push({ asset_id: a.id, name: a.name });
      }
      return text({
        workspace: w.ws.name,
        status: row.status,
        version: row.version,
        source: row.source,
        kit: { ...kit, logos, imagery: { ...kit.imagery, references } },
        font_stacks: {
          heading: [kit.type.heading.family && `'${kit.type.heading.family}'`, kit.type.heading.fallback].filter(Boolean).join(', '),
          body: [kit.type.body.family && `'${kit.type.body.family}'`, kit.type.body.fallback].filter(Boolean).join(', '),
        },
        missing: missing(kit),
        warnings: warnings(kit),
        how_to: 'Use these values, not guesses: colours by role, the font stacks (the family first, then the email-safe fallback), sizes in px, the button style and the content width. For generated imagery follow imagery.style and its do/don\'t rules (view_image on a reference to see the look). Keep headline copy as live text, not baked into images.',
      });
    }
    case 'save_brand_kit': {
      const w = await ownWorkspace(ctx, args.workspace_id);
      if ('error' in w) return toolError(w.error);
      if (!args.kit || typeof args.kit !== 'object') return toolError('Pass kit as an object (see the tool description for its shape).');
      const existing = await ctx.repo.getBrandKit(w.ws.id);
      const base = args.mode === 'replace' || !existing ? normaliseKit({ name: w.ws.name }, w.ws.name) : normaliseKit(existing.kit, w.ws.name);
      const kit = mergeKit(base, args.kit);
      // Logo and reference ids must be this workspace's own assets.
      for (const role of ['primary', 'reversed', 'icon'] as const) {
        const id = kit.logos[role];
        if (id && !(await sameWorkspaceAsset(ctx, id, w.ws.id))) kit.logos[role] = null;
      }
      const refs: string[] = [];
      for (const id of kit.imagery.references) if (await sameWorkspaceAsset(ctx, id, w.ws.id)) refs.push(id);
      kit.imagery.references = refs;
      const notes: string[] = [];
      if (args.logo_url) {
        const got = await fetchLimited(String(args.logo_url), { accept: 'image/*', maxBytes: 5_000_000, fetchImpl: ctx.fetchImpl });
        if ('error' in got || !(got.type.startsWith('image/') || /\.svg(\?|$)/i.test(String(args.logo_url)))) notes.push(`Couldn't import the logo from logo_url (${'error' in got ? got.error : 'not an image'}).`);
        else {
          const type = got.type.startsWith('image/') ? got.type : 'image/svg+xml';
          const path = `${w.ws.id}/brand/${crypto.randomUUID()}.${IMAGE_EXT[type] || 'png'}`;
          await ctx.repo.upload(path, got.buf, type);
          const size = imageSize(got.buf);
          const logo = await ctx.repo.insertAsset({
            workspace_id: w.ws.id, kind: 'logo', name: `${kit.name || w.ws.name} logo`.slice(0, 120), storage_path: path, mime: type, bytes: got.buf.length,
            width: size?.w ?? null, height: size?.h ?? null, origin: 'uploaded', status: 'approved', created_by: ctx.userId,
            provenance: { via: 'brand_kit', imported_from: args.source?.figma_url || String(args.logo_url).slice(0, 300), at: new Date().toISOString() },
          });
          kit.logos.primary = logo.id;
          notes.push('Logo imported into Logos.');
        }
      }
      const figmaUrl = args.source?.figma_url ? String(args.source.figma_url).slice(0, 500) : null;
      const saved = await ctx.repo.saveBrandKit({
        workspace_id: w.ws.id,
        kit,
        status: 'draft',
        version: (existing?.version || 0) + 1,
        source: figmaUrl || args.source?.file_key
          ? { type: 'figma', url: figmaUrl, file_key: args.source?.file_key ? String(args.source.file_key).slice(0, 80) : null, at: new Date().toISOString() }
          : existing?.source || { type: 'manual', at: new Date().toISOString() },
        updated_by: ctx.userId,
      });
      return text({ ok: true, workspace: w.ws.name, status: saved.status, version: saved.version, kit, missing: missing(kit), warnings: warnings(kit), notes, next: 'Saved as a draft. Ask the user to review and approve it in Emailsy → Brand kit.' });
    }
    case 'add_generated_asset': {
      const w = await ownWorkspace(ctx, args.workspace_id);
      if ('error' in w) return toolError(w.error);
      let kind = args.kind === 'logo' ? 'logo' : args.kind === 'video' ? 'video' : 'image';
      const name = String(args.name || '').trim().slice(0, 120);
      if (!name) return toolError('Give the asset a name.');
      let u: URL;
      try { u = new URL(String(args.image_url)); } catch { return toolError('image_url is not a valid URL.'); }
      if (u.protocol !== 'https:') return toolError('image_url must be an https address.');
      const got = await fetchLimited(u, { accept: 'image/*,video/*', maxBytes: 100 * 1024 * 1024, timeoutMs: 45000, fetchImpl: ctx.fetchImpl });
      if ('error' in got) return toolError(`Couldn't download the file (${got.error}).`);
      // Some storage hosts send a generic type: fall back to the file extension.
      let type = got.type;
      if (!/^(image|video)\//.test(type)) {
        const ext = u.pathname.toLowerCase().match(/\.(png|jpe?g|webp|gif|mp4|webm|mov)$/)?.[1];
        type = ext ? ({ png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' } as Record<string, string>)[ext] : type;
      }
      if (/^video\//.test(type)) kind = 'video';
      if (!/image\/(png|jpeg|webp|gif|svg\+xml)|video\/(mp4|webm|quicktime)/.test(type)) return toolError(`That URL isn't an image (PNG, JPEG, WebP) or video (MP4, WebM): ${got.type || 'unknown type'}.`);
      if (kind !== 'video' && got.buf.length > 25 * 1024 * 1024) return toolError('That image is over 25 MB.');
      let product: AssetRow | null = null;
      if (args.source_product_pid) {
        const hits = await ctx.repo.listAssets([w.ws.id], { kind: 'product', query: String(args.source_product_pid), limit: 20 });
        product = hits.find((h) => h.pid === String(args.source_product_pid)) || null;
      }
      const sources: string[] = [];
      for (const id of Array.isArray(args.source_asset_ids) ? args.source_asset_ids.slice(0, 10) : []) if (await sameWorkspaceAsset(ctx, String(id), w.ws.id)) sources.push(String(id));
      if (product && !sources.includes(product.id)) sources.unshift(product.id);
      const kitRow = await ctx.repo.getBrandKit(w.ws.id);
      const ext = IMAGE_EXT[type] || ({ 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' } as Record<string, string>)[type] || 'png';
      const path = `${w.ws.id}/generated/${crypto.randomUUID()}.${ext}`;
      await ctx.repo.upload(path, got.buf, type);
      const size = kind === 'video' ? null : imageSize(got.buf);
      const row = await ctx.repo.insertAsset({
        workspace_id: w.ws.id, kind, name, storage_path: path, mime: type, bytes: got.buf.length, width: size?.w ?? null, height: size?.h ?? null,
        origin: 'generated', status: 'draft', created_by: ctx.userId,
        fields: args.alt ? { alt: String(args.alt).slice(0, 300) } : {},
        provenance: {
          prompt: args.prompt ? String(args.prompt).slice(0, 4000) : null,
          model: args.model ? String(args.model).slice(0, 120) : null,
          style: args.style ? String(args.style).slice(0, 200) : null,
          source_product_pid: product?.pid || (args.source_product_pid ? String(args.source_product_pid).slice(0, 80) : null),
          source_asset_ids: sources,
          brand_kit_version: kitRow?.version ?? null,
          generated_at: new Date().toISOString(),
        },
        figma: args.figma_file_key && args.figma_node_id ? { file_key: String(args.figma_file_key).slice(0, 80), node_id: String(args.figma_node_id).slice(0, 40), component_key: null, note: 'Designed in Figma', placed_at: new Date().toISOString() } : null,
      });
      return text({ ok: true, asset: publicAsset(row, w.ws), next: 'Saved as a draft in Emailsy. A person approves it there before it counts as approved.' });
    }
    default:
      return null;
  }
}

async function ownWorkspace(ctx: Ctx, id: unknown): Promise<{ ws: Workspace } | { error: string }> {
  const ws = await ctx.repo.workspacesForUser(ctx.userId);
  const w = ws.find((x) => x.id === id);
  return w ? { ws: w } : { error: 'That workspace is not one of yours. Call list_workspaces for valid ids.' };
}

async function sameWorkspaceAsset(ctx: Ctx, id: string, workspaceId: string) {
  const a = await ctx.repo.getAsset(id);
  return !!a && a.workspace_id === workspaceId;
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
          capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
          serverInfo: { name: 'emailsy-cms', title: 'Emailsy CMS', version: '0.2.0' },
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
        return reply({
          prompts: PROMPTS.map((p) => ({
            name: p.id,
            title: p.title,
            description: `${p.format} · ${p.uses.map((u) => USE_LABEL[u]).join(' + ')}`,
            arguments: [
              { name: 'brand', description: 'Workspace (brand) name', required: false },
              ...(p.prompt.includes('{product}') ? [{ name: 'product', description: 'Product name or PID from Emailsy', required: false }] : []),
              ...(p.prompt.includes('{image}') ? [{ name: 'image', description: 'Image name from Emailsy', required: false }] : []),
            ],
          })),
        });
      case 'prompts/get': {
        const p = PROMPTS.find((x) => x.id === msg.params?.name);
        if (!p) return fail(-32602, `Unknown prompt: ${msg.params?.name}`);
        const a = msg.params?.arguments || {};
        const ws = await ctx.repo.workspacesForUser(ctx.userId);
        const w = ws.find((x) => x.name.toLowerCase() === String(a.brand || '').toLowerCase()) || (ws.length === 1 ? ws[0] : undefined);
        const product = a.product ? String(a.product) : null;
        const text = fillPrompt(p.prompt, {
          brand: w?.name || (a.brand ? String(a.brand) : ''),
          product,
          pid: product && /^[\w-]+$/.test(product) ? product : null,
          image: a.image ? String(a.image) : null,
          figma: w?.figma_file_url || null,
        });
        return reply({ description: p.title, messages: [{ role: 'user', content: { type: 'text', text: `${text}\n\n(Use the Emailsy CMS connector for the brand kit and assets.)` } }] });
      }
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
