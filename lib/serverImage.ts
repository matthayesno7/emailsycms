// Image edits on the server (for the Claude connector): crop, resize, rotate, flip and simple
// adjustments with sharp, plus the email-ready copy (max 1200px wide). The app does the same
// edits in the browser (lib/imageEdit.ts); these are the same sizes and the same rules.
import { FORMATS } from './design';

export const EMAIL_MAX_W = 1200;

// Named sizes Claude can ask for. Email sizes are at 2x for sharp retina screens.
export function sizePresets(contentWidth = 600, team: { name: string; w: number; h: number }[] = []) {
  const W = contentWidth * 2;
  const out: Record<string, { label: string; w: number; h: number }> = {
    'email-full': { label: 'Email, full width', w: W, h: Math.round(W / 2) },
    'email-two-column': { label: 'Email, two column', w: Math.round(W / 2 - 40), h: Math.round(W / 2 - 40) },
    'email-mobile-hero': { label: 'Email, mobile hero', w: 640, h: 800 },
    'marketplace-square': { label: 'Marketplace square', w: 2000, h: 2000 },
    'shopify-product': { label: 'Shopify product', w: 2048, h: 2048 },
    'product-portrait': { label: 'Product portrait', w: 1600, h: 2000 },
  };
  for (const f of FORMATS) if (!f.video && f.id !== 'email-hero') out[f.id] = { label: f.label, w: f.w, h: f.h };
  for (const t of team) out[`team:${t.name.toLowerCase()}`] = { label: t.name, w: t.w, h: t.h };
  return out;
}

export type ServerEdit = {
  width?: number; height?: number;           // final size; with both, the crop fills it (around the focal point)
  ratio?: number;                            // crop to this shape (w/h) without resizing
  crop?: { x: number; y: number; w: number; h: number }; // 0..1 of the picture, before the size
  rotate?: 0 | 90 | 180 | 270;
  flip?: boolean;                            // left-right mirror
  brightness?: number; saturation?: number;  // -100..100
  focus?: { x: number; y: number } | null;   // keep this point in view when cropping
};

async function lib() {
  try { return (await import('sharp')).default; } catch { return null; }
}
export const canEdit = async () => !!(await lib());

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

// The biggest box with this shape inside w×h, centred on the focal point.
export function focalBox(w: number, h: number, ratio: number, focus?: { x: number; y: number } | null) {
  const cw = ratio > w / h ? w : Math.round(h * ratio);
  const ch = ratio > w / h ? Math.round(w / ratio) : h;
  const fx = (focus?.x ?? 0.5) * w, fy = (focus?.y ?? 0.5) * h;
  return { left: Math.round(clamp(fx - cw / 2, 0, w - cw)), top: Math.round(clamp(fy - ch / 2, 0, h - ch)), width: cw, height: ch };
}

export function describeEdit(e: ServerEdit, out: { w: number; h: number }) {
  const bits: string[] = [];
  if (e.width || e.height || e.ratio || e.crop) bits.push(e.width || e.height ? `Resized to ${out.w}×${out.h}` : `Cropped to ${out.w}×${out.h}`);
  if (e.rotate) bits.push(`rotated ${e.rotate}°`);
  if (e.flip) bits.push('flipped');
  if (e.brightness) bits.push(e.brightness > 0 ? 'brighter' : 'darker');
  if (e.saturation) bits.push(e.saturation > 0 ? 'more colour' : 'less colour');
  const s = bits.join(', ');
  return (s ? s[0].toUpperCase() + s.slice(1) : 'Edited') + ' (with Claude)';
}

export async function editImage(buf: Buffer, mime: string, e: ServerEdit): Promise<{ buf: Buffer; mime: string; width: number; height: number } | { error: string }> {
  const sharp = await lib();
  if (!sharp) return { error: 'Image editing isn’t available on this server.' };
  if (/svg|gif/.test(mime)) return { error: 'SVGs and GIFs can’t be edited here.' };
  // One step at a time on a flat buffer, so each step sees the real size (sharp applies one rotate per pipeline).
  // Steps pass lossless PNG between them; the final file goes back to the original format.
  let cur = await sharp(buf, { failOn: 'none' }).rotate().png({ compressionLevel: 1 }).toBuffer({ resolveWithObject: true }); // camera orientation first
  const step = async (fn: (s: any) => any) => { cur = await fn(sharp(cur.data)).png({ compressionLevel: 1 }).toBuffer({ resolveWithObject: true }); };
  if (e.rotate) await step((s) => s.rotate(e.rotate));
  if (e.flip) await step((s) => s.flop());
  const W = () => cur.info.width, H = () => cur.info.height;
  if (e.crop) {
    const c = { x: clamp(e.crop.x, 0, 1), y: clamp(e.crop.y, 0, 1), w: clamp(e.crop.w, 0.01, 1), h: clamp(e.crop.h, 0.01, 1) };
    const box = { left: Math.round(c.x * W()), top: Math.round(c.y * H()), width: Math.max(1, Math.round(Math.min(c.w, 1 - c.x) * W())), height: Math.max(1, Math.round(Math.min(c.h, 1 - c.y) * H())) };
    await step((s) => s.extract(box));
  }
  const target = e.width && e.height ? e.width / e.height : e.ratio || null;
  if (target && !e.crop) {
    const box = focalBox(W(), H(), target, e.focus);
    if (box.width !== W() || box.height !== H()) await step((s) => s.extract(box));
  }
  if (e.width || e.height) {
    const w = e.width ? clamp(Math.round(e.width), 16, 8000) : undefined, h = e.height ? clamp(Math.round(e.height), 16, 8000) : undefined;
    await step((s) => s.resize(w, h, { fit: w && h ? 'fill' : 'inside' }));
  }
  if (e.brightness || e.saturation) {
    await step((s) => s.modulate({ brightness: 1 + clamp(e.brightness || 0, -100, 100) / 200, saturation: 1 + clamp(e.saturation || 0, -100, 100) / 100 }));
  }
  const png = /png/.test(mime), webp = /webp/.test(mime);
  const out = sharp(cur.data);
  const data = png ? await out.png({ compressionLevel: 9 }).toBuffer() : webp ? await out.webp({ quality: 88 }).toBuffer() : await out.flatten({ background: '#ffffff' }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  return { buf: data, mime: png ? 'image/png' : webp ? 'image/webp' : 'image/jpeg', width: W(), height: H() };
}

// Email-ready copy: at most 1200px wide, compressed; PNG kept for transparency. Null when the original already is.
export async function emailCopy(buf: Buffer, mime: string): Promise<{ buf: Buffer; mime: string; width: number; height: number; format: 'png' | 'jpg' } | null> {
  const sharp = await lib();
  if (!sharp || /svg|gif/.test(mime)) return null;
  try {
    const meta = await sharp(buf).metadata();
    if (!meta.width || !meta.height) return null;
    if (meta.width <= EMAIL_MAX_W && buf.length <= 350 * 1024 && /jpe?g|png/.test(mime)) return null;
    const alpha = !!meta.hasAlpha && /png|webp/.test(mime);
    const s = sharp(buf).rotate().resize({ width: Math.min(EMAIL_MAX_W, meta.width), withoutEnlargement: true });
    const r = alpha ? await s.png({ compressionLevel: 9, palette: false }).toBuffer({ resolveWithObject: true }) : await s.flatten({ background: '#ffffff' }).jpeg({ quality: 84, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    return { buf: r.data, mime: alpha ? 'image/png' : 'image/jpeg', width: r.info.width, height: r.info.height, format: alpha ? 'png' : 'jpg' };
  } catch { return null; }
}
