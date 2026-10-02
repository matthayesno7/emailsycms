'use client';
// Manual image editing (Edit mode on the asset page): crop, resize, rotate, flip, brightness,
// contrast and saturation, all in the browser. Pure helpers first (tested on their own),
// then the canvas pipeline that renders a preview and the full-size file.
import type { BrandKit } from './brandKit';
import { FORMATS } from './design';
import { cutWhite } from './images';

export type Rect = { x: number; y: number; w: number; h: number }; // 0..1 of the rotated image
export type Edit = {
  rotate: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
  brightness: number; // -100..100
  contrast: number;   // -100..100
  saturation: number; // -100..100
  crop: Rect | null;  // null: the whole picture
  ratio: number | null; // locked crop ratio (w/h), null: free
  out: { w: number; h: number } | null; // final size; null: the crop's own pixels
  cutWhite: boolean;
};
export const NO_EDIT: Edit = { rotate: 0, flipH: false, flipV: false, brightness: 0, contrast: 0, saturation: 0, crop: null, ratio: null, out: null, cutWhite: false };

export const isUnchanged = (e: Edit) => !e.rotate && !e.flipH && !e.flipV && !e.brightness && !e.contrast && !e.saturation && !e.crop && !e.out && !e.cutWhite;

// The picture's size once rotated.
export const turned = (w: number, h: number, rotate: number) => (rotate % 180 ? { w: h, h: w } : { w, h });

// Pixel size of the crop, before any resize.
export function cropPixels(e: Edit, srcW: number, srcH: number) {
  const t = turned(srcW, srcH, e.rotate);
  const c = e.crop || { x: 0, y: 0, w: 1, h: 1 };
  return { x: Math.round(c.x * t.w), y: Math.round(c.y * t.h), w: Math.max(1, Math.round(c.w * t.w)), h: Math.max(1, Math.round(c.h * t.h)) };
}
export function outputSize(e: Edit, srcW: number, srcH: number) {
  if (e.out) return e.out;
  const c = cropPixels(e, srcW, srcH);
  return { w: c.w, h: c.h };
}

// The biggest centred crop with this ratio (w/h), on a picture of size t.
export function centredCrop(ratio: number, t: { w: number; h: number }, around?: { x: number; y: number }): Rect {
  const pr = t.w / t.h;
  const w = ratio > pr ? 1 : ratio / pr, h = ratio > pr ? pr / ratio : 1;
  const cx = around?.x ?? 0.5, cy = around?.y ?? 0.5;
  return { x: clamp(cx - w / 2, 0, 1 - w), y: clamp(cy - h / 2, 0, 1 - h), w, h };
}
export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

// Move or resize a crop box while keeping it inside the picture and, when locked, at its ratio.
// handle: 'move' | 'nw' | 'ne' | 'sw' | 'se'; dx, dy in 0..1 of the picture; ratioN is w/h in normalised units.
export function dragCrop(c: Rect, handle: string, dx: number, dy: number, ratioN: number | null, min = 0.04): Rect {
  if (handle === 'move') return { ...c, x: clamp(c.x + dx, 0, 1 - c.w), y: clamp(c.y + dy, 0, 1 - c.h) };
  const left = handle.includes('w'), top = handle.includes('n');
  // The fixed corner stays put.
  const fx = left ? c.x + c.w : c.x, fy = top ? c.y + c.h : c.y;
  let w = clamp((left ? fx - (c.x + dx) : c.x + c.w + dx - c.x), min, left ? fx : 1 - fx);
  let h = clamp((top ? fy - (c.y + dy) : c.y + c.h + dy - c.y), min, top ? fy : 1 - fy);
  if (ratioN) {
    // Follow whichever side moved more, then fit inside the limits.
    if (Math.abs(dx) >= Math.abs(dy)) h = w / ratioN; else w = h * ratioN;
    const maxW = left ? fx : 1 - fx, maxH = top ? fy : 1 - fy;
    if (w > maxW) { w = maxW; h = w / ratioN; }
    if (h > maxH) { h = maxH; w = h * ratioN; }
  }
  return { x: left ? fx - w : fx, y: top ? fy - h : fy, w, h };
}

// What changed, in plain words, for the version history.
export function describe(e: Edit, srcW: number, srcH: number) {
  const bits: string[] = [];
  const o = outputSize(e, srcW, srcH);
  if (e.crop || e.out) bits.push(e.out ? `Resized to ${o.w}×${o.h}` : `Cropped to ${o.w}×${o.h}`);
  if (e.rotate) bits.push(`rotated ${e.rotate}°`);
  if (e.flipH) bits.push('flipped');
  if (e.flipV) bits.push('flipped vertically');
  const adj = (v: number, up: string, down: string) => v && bits.push(v > 0 ? up : down);
  adj(e.brightness, 'brighter', 'darker');
  adj(e.contrast, 'more contrast', 'less contrast');
  adj(e.saturation, 'more colour', 'less colour');
  if (e.cutWhite) bits.push('white background removed');
  const s = bits.join(', ');
  return s ? s[0].toUpperCase() + s.slice(1) : 'Edited';
}

// ---------- sizes: from the brand kit, social formats, retailers, and the team's own ----------
export type Preset = { id: string; name: string; w?: number; h?: number; ratio?: number };
export type PresetGroup = { name: string; items: Preset[] };
export type TeamPreset = { name: string; w: number; h: number };

export function presetGroups(kit: BrandKit | null | undefined): PresetGroup[] {
  const W = (kit?.layout?.width || 600) * 2; // email content width at 2x for sharp retina screens
  const team = ((kit as any)?.presets || []) as TeamPreset[];
  return [
    { name: 'Crop', items: [{ id: 'free', name: 'Free' }, { id: 'orig', name: 'Original ratio' }, { id: 'r1', name: '1:1', ratio: 1 }, { id: 'r45', name: '4:5', ratio: 4 / 5 }, { id: 'r169', name: '16:9', ratio: 16 / 9 }, { id: 'r32', name: '3:2', ratio: 3 / 2 }] },
    { name: 'Email', items: [{ id: 'e-full', name: 'Full width', w: W, h: Math.round(W / 2) }, { id: 'e-half', name: 'Two column', w: Math.round(W / 2 - 40), h: Math.round(W / 2 - 40) }, { id: 'e-mob', name: 'Mobile hero', w: 640, h: 800 }] },
    { name: 'Social', items: FORMATS.filter((f) => !f.video && f.id !== 'email-hero').map((f) => ({ id: `s-${f.id}`, name: f.label, w: f.w, h: f.h })) },
    { name: 'Retail', items: [{ id: 'm-square', name: 'Marketplace square', w: 2000, h: 2000 }, { id: 'm-shopify', name: 'Shopify product', w: 2048, h: 2048 }, { id: 'm-portrait', name: 'Product portrait', w: 1600, h: 2000 }] },
    ...(team.length ? [{ name: 'Your team', items: team.map((t, i) => ({ id: `t-${i}`, name: t.name, w: t.w, h: t.h })) }] : []),
  ];
}

export function cleanTeamPresets(v: unknown): TeamPreset[] {
  return (Array.isArray(v) ? v : []).map((p: any) => ({ name: String(p?.name || '').trim().slice(0, 40), w: Math.round(Number(p?.w)), h: Math.round(Number(p?.h)) }))
    .filter((p) => p.name && p.w >= 16 && p.h >= 16 && p.w <= 8000 && p.h <= 8000).slice(0, 30);
}

// ---------- adjustments ----------
// Brightness shifts, contrast pivots on mid-grey, saturation blends with the pixel's grey.
export function adjustPixels(d: Uint8ClampedArray, brightness: number, contrast: number, saturation: number) {
  if (!brightness && !contrast && !saturation) return;
  const b = brightness * 1.28;
  const cv = contrast * 2.55, cf = (259 * (cv + 255)) / (255 * (259 - cv));
  const s = 1 + saturation / 100;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] + b, g = d[i + 1] + b, bl = d[i + 2] + b;
    r = cf * (r - 128) + 128; g = cf * (g - 128) + 128; bl = cf * (bl - 128) + 128;
    if (s !== 1) { const grey = 0.299 * r + 0.587 * g + 0.114 * bl; r = grey + (r - grey) * s; g = grey + (g - grey) * s; bl = grey + (bl - grey) * s; }
    d[i] = r; d[i + 1] = g; d[i + 2] = bl; // Uint8ClampedArray clamps to 0..255
  }
}

// ---------- canvas pipeline ----------
type Src = HTMLImageElement | HTMLCanvasElement;
const dims = (s: Src) => ({ w: (s as HTMLImageElement).naturalWidth || s.width, h: (s as HTMLImageElement).naturalHeight || s.height });

// The whole picture, rotated, flipped and adjusted, at most maxSide pixels on its longest side.
export function renderBase(src: Src, e: Edit, maxSide = Infinity, cutCache?: { cut?: HTMLCanvasElement }): HTMLCanvasElement {
  let source: Src = src;
  if (e.cutWhite && src instanceof HTMLImageElement) source = cutCache?.cut || (cutCache ? (cutCache.cut = cutWhite(src)) : cutWhite(src));
  const { w: sw, h: sh } = dims(source);
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * k)), h = Math.max(1, Math.round(sh * k));
  const t = turned(w, h, e.rotate);
  const cv = document.createElement('canvas');
  cv.width = t.w; cv.height = t.h;
  const cx = cv.getContext('2d', { willReadFrequently: true })!;
  cx.imageSmoothingQuality = 'high';
  cx.translate(t.w / 2, t.h / 2);
  cx.rotate((e.rotate * Math.PI) / 180);
  cx.scale(e.flipH ? -1 : 1, e.flipV ? -1 : 1);
  cx.drawImage(source, -w / 2, -h / 2, w, h);
  if (e.brightness || e.contrast || e.saturation) {
    const img = cx.getImageData(0, 0, t.w, t.h);
    adjustPixels(img.data, e.brightness, e.contrast, e.saturation);
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.putImageData(img, 0, 0);
  }
  return cv;
}

// The finished picture at full size: crop, then resize to the chosen size.
export function renderFinal(src: Src, e: Edit, cutCache?: { cut?: HTMLCanvasElement }): HTMLCanvasElement {
  const base = renderBase(src, e, Infinity, cutCache);
  const c = e.crop || { x: 0, y: 0, w: 1, h: 1 };
  const sx = Math.round(c.x * base.width), sy = Math.round(c.y * base.height);
  const sw = Math.max(1, Math.round(c.w * base.width)), sh = Math.max(1, Math.round(c.h * base.height));
  const out = e.out || { w: sw, h: sh };
  const cv = document.createElement('canvas');
  cv.width = out.w; cv.height = out.h;
  const cx = cv.getContext('2d')!;
  cx.imageSmoothingQuality = 'high';
  cx.drawImage(base, sx, sy, sw, sh, 0, 0, out.w, out.h);
  return cv;
}

// Keep the original format where we can; transparency stays PNG.
export function outputType(mime: string, e: Edit) {
  if (e.cutWhite) return 'image/png';
  if (/png/.test(mime)) return 'image/png';
  if (/webp/.test(mime)) return 'image/webp';
  return 'image/jpeg';
}

export function encode(cv: HTMLCanvasElement, type: string, quality = 0.9): Promise<Blob> {
  return new Promise((resolve, reject) => cv.toBlob((b) => {
    if (b && (b.type === type || type !== 'image/webp')) resolve(b);
    else if (type === 'image/webp') cv.toBlob((p) => (p ? resolve(p) : reject(new Error('export failed'))), 'image/png'); // no WebP encoder (older Safari)
    else reject(new Error('export failed'));
  }, type, quality));
}

// Downloads in a chosen format and size, from any picture.
export async function exportAs(src: Src, format: 'jpg' | 'png' | 'webp', maxW: number | null): Promise<Blob> {
  const { w, h } = dims(src);
  const k = maxW && w > maxW ? maxW / w : 1;
  const cv = document.createElement('canvas');
  cv.width = Math.round(w * k); cv.height = Math.round(h * k);
  const cx = cv.getContext('2d')!;
  cx.imageSmoothingQuality = 'high';
  if (format === 'jpg') { cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, cv.width, cv.height); }
  cx.drawImage(src, 0, 0, cv.width, cv.height);
  return encode(cv, format === 'jpg' ? 'image/jpeg' : format === 'png' ? 'image/png' : 'image/webp', format === 'jpg' ? 0.88 : 0.86);
}
