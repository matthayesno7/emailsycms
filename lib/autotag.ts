// Auto-organising: what Claude is asked about each image, and how its answer becomes
// the asset's description, tags, colours and so on. Pure functions (no database), so they
// can be tested on their own; lib/autotagWorker.ts does the fetching and saving.
import type { BrandKit } from './brandKit';
import { colourNames, matchBrand } from './colours';

export const TAG_MODEL = process.env.ANTHROPIC_TAG_MODEL || 'claude-haiku-4-5-20251001';
// Claude reads PNG, JPEG, WebP and GIF. Everything else (SVG, AVIF) is organised from its name.
export const VISION_TYPES = /^image\/(png|jpeg|webp|gif)$/;
export const MAX_VISION_BYTES = 4_800_000;

export type Candidate = { id: string; name: string; pid?: string | null };
export type TagInput = { name: string; kind: string; folder?: string | null; kit?: BrandKit | null; products?: Candidate[] };

const words = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').split(' ').filter((w) => w.length > 2);
const STOP = new Set(['img', 'image', 'photo', 'final', 'copy', 'edit', 'new', 'the', 'and', 'for', 'with', 'jpg', 'png', 'web', 'hero', 'banner', 'email', 'dsc', 'screenshot']);

// Which products might be in this picture: all of them for a small catalogue, otherwise the
// ones whose name or PID shares a word with the file or folder name. None when nothing matches,
// so Claude isn't tempted to pick one at random.
export function shortlist(products: Candidate[], name: string, folder?: string | null, max = 40): Candidate[] {
  if (!products.length) return [];
  if (products.length <= max) return products;
  const hay = new Set(words(`${name} ${folder || ''}`).filter((w) => !STOP.has(w)));
  if (!hay.size) return [];
  const scored = products.map((p) => {
    const pw = words(`${p.name} ${p.pid || ''}`);
    const hits = pw.filter((w) => hay.has(w)).length + (p.pid && name.toLowerCase().includes(p.pid.toLowerCase()) ? 3 : 0);
    return { p, hits };
  }).filter((s) => s.hits > 0).sort((a, b) => b.hits - a.hits);
  return scored.slice(0, max).map((s) => s.p);
}

function kitBrief(kit?: BrandKit | null) {
  if (!kit) return { colours: '', rules: '' };
  const colours = Object.entries(kit.colors || {}).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', ');
  const im = kit.imagery || ({} as BrandKit['imagery']);
  const rules = [im.style && `Style: ${im.style}`, im.do?.length && `Do: ${im.do.join('; ')}`, im.dont?.length && `Don't: ${im.dont.join('; ')}`].filter(Boolean).join('\n');
  return { colours, rules };
}

export function tagPrompt(t: TagInput) {
  const { colours, rules } = kitBrief(t.kit);
  const products = t.products || [];
  return [
    `You're organising a brand's asset library so people can find this ${t.kind === 'logo' ? 'logo' : t.kind === 'product' ? 'product image' : 'image'} by searching in plain words.`,
    `File name: "${t.name}"${t.folder ? `, in the folder "${t.folder}"` : ''}.`,
    colours ? `Brand colours: ${colours}.` : '',
    rules ? `Brand imagery rules:\n${rules}` : '',
    products.length ? `Products in the catalogue that might be pictured (id: name):\n${products.map((p) => `${p.id}: ${p.name}${p.pid ? ` (${p.pid})` : ''}`).join('\n')}` : '',
    '',
    'Reply with JSON only, in this shape:',
    '{',
    '  "description": "One or two plain sentences: what is shown, who, where, the feel. Concrete and searchable.",',
    '  "tags": ["5 to 15 lowercase tags: subject, objects and colours of key items, setting, season, mood, shot type (lifestyle, product shot, flat lay, close-up, cut-out, portrait, landscape scene, pattern, illustration, logo, screenshot, text graphic), and likely use (hero, social, background)"],',
    '  "colours": ["up to 5 dominant colours as #rrggbb, most prominent first"],',
    '  "text_in_image": "Any words visible in the image, exactly as written. Empty string if none.",',
    rules ? '  "on_brand": {"ok": true or false, "reason": "One short sentence on how it fits the imagery rules."},' : '  "on_brand": null,',
    products.length ? '  "product": {"id": "an id from the list", "confidence": "high or medium"} or null' : '  "product": null',
    '}',
    'Only describe what you can see. Don\'t identify real people by name. Use "high" confidence only when the product is clearly the one listed (shape, colour and details match); otherwise "medium" or null.',
  ].filter((l) => l !== '').join('\n');
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const HEX = /^#[0-9a-f]{6}$/;

export type TagResult = {
  description: string;
  tags: string[];
  colours: string[];
  text_in_image: string;
  on_brand: { ok: boolean; reason: string } | null;
  product: { id: string; confidence: 'high' | 'medium' } | null;
};

// Claude's reply, cleaned: anything malformed is dropped rather than trusted.
export function cleanResult(raw: any, t: TagInput): TagResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const description = str(raw.description, 400);
  const tags = [...new Set((Array.isArray(raw.tags) ? raw.tags : []).map((x: unknown) => str(x, 40).toLowerCase().replace(/^#/, '')).filter(Boolean))].slice(0, 15) as string[];
  if (!description && !tags.length) return null;
  const colours = [...new Set((Array.isArray(raw.colours ?? raw.colors) ? raw.colours ?? raw.colors : []).map((x: unknown) => str(x, 9).toLowerCase()).map((h: string) => (h.startsWith('#') ? h : '#' + h)).filter((h: string) => HEX.test(h)))].slice(0, 5) as string[];
  const ob = raw.on_brand;
  const on_brand = ob && typeof ob === 'object' && typeof ob.ok === 'boolean' && t.kit?.imagery && (t.kit.imagery.style || t.kit.imagery.do?.length || t.kit.imagery.dont?.length)
    ? { ok: ob.ok, reason: str(ob.reason, 200) } : null;
  const pr = raw.product;
  const ids = new Set((t.products || []).map((p) => p.id));
  const product = pr && typeof pr === 'object' && ids.has(String(pr.id)) && ['high', 'medium'].includes(pr.confidence) ? { id: String(pr.id), confidence: pr.confidence } as TagResult['product'] : null;
  return { description, tags, colours, text_in_image: str(raw.text_in_image, 500), on_brand, product };
}

// Files Claude can't look at still get findable tags from their name.
export function nameTags(name: string, kind: string) {
  const base = words(name).filter((w) => !STOP.has(w) && !/^\d+$/.test(w)).slice(0, 8);
  return [...new Set([kind === 'logo' ? 'logo' : kind === 'product' ? 'product shot' : '', ...base].filter(Boolean))];
}

type AssetLike = { kind: string; edited?: string[] | null; fields?: any; product_id?: string | null };

// The update for an asset: what the AI found, except anything a person has edited.
export function patchFrom(a: AssetLike, r: TagResult, kit: BrandKit | null | undefined, model: string) {
  const edited = new Set(a.edited || []);
  const brand = matchBrand(r.colours, kit);
  const patch: Record<string, any> = {
    colours: r.colours,
    colour_names: colourNames(r.colours),
    text_in_image: r.text_in_image || null,
    ai: { ...r, brand_colours: brand, model, at: new Date().toISOString() },
    ai_status: 'done',
    ai_error: null,
  };
  if (!edited.has('on_brand')) { patch.on_brand = r.on_brand ? r.on_brand.ok : null; patch.on_brand_reason = r.on_brand?.reason || null; }
  if (!edited.has('description')) patch.description = r.description || null;
  if (!edited.has('tags')) patch.tags = r.tags;
  // Alt text for email, when nobody has written one yet.
  if (r.description && !a.fields?.alt && a.kind !== 'block') patch.fields = { ...(a.fields || {}), alt: r.description.split(/(?<=\.)\s/)[0].slice(0, 150) };
  // Link the product when Claude is sure and the asset isn't linked to one already.
  if (r.product?.confidence === 'high' && !a.product_id && a.kind !== 'product' && !edited.has('product')) patch.product_id = r.product.id;
  return patch;
}

// Rough cost of organising n files with Haiku (image plus prompt in, short JSON out), in GBP.
export const COST_PER_FILE_GBP = 0.0035;
