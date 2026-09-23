'use client';
// Email-ready copies of uploaded images: at most 1200px wide (600px email width at 2x for
// retina screens) and compressed, so they look sharp and load fast in an inbox.
import type { SupabaseClient } from '@supabase/supabase-js';
import { drawFit, toBlob } from './images';

export const EMAIL_MAX_W = 1200;
const SMALL_ENOUGH = 350 * 1024;

type Src = HTMLImageElement | HTMLCanvasElement;
const dims = (s: Src) => ({ w: (s as HTMLImageElement).naturalWidth || s.width, h: (s as HTMLImageElement).naturalHeight || s.height });

// Returns the images.email entry, or null when the original is already email-ready (or can't be resized: SVG, GIF).
export async function emailRendition(supabase: SupabaseClient, ws: string, source: Src, opts: { mime: string; bytes?: number; force?: boolean }) {
  if (/svg|gif/.test(opts.mime)) return null;
  const { w: sw, h: sh } = dims(source);
  if (!sw || !sh) return null;
  if (!opts.force && sw <= EMAIL_MAX_W && (opts.bytes || 0) <= SMALL_ENOUGH && /jpe?g|png/.test(opts.mime)) return null;
  const png = /png|webp/.test(opts.mime) && hasTransparency(source);
  const w = Math.min(EMAIL_MAX_W, sw), h = Math.round((sh * w) / sw);
  const cv = drawFit(source, w, h, 'cover', null, !png);
  const type = png ? 'image/png' : 'image/jpeg';
  const blob = await toBlob(cv, type, 0.84);
  const path = `${ws}/email/${crypto.randomUUID()}.${png ? 'png' : 'jpg'}`;
  const { error } = await supabase.storage.from('assets').upload(path, blob, { contentType: type });
  if (error) return null;
  return { path, width: w, height: h, bytes: blob.size, format: png ? 'png' : 'jpg' };
}

// Samples the image for any transparent pixels (logos and cut-outs keep PNG).
function hasTransparency(source: Src) {
  try {
    const { w, h } = dims(source);
    const k = Math.min(1, 200 / Math.max(w, h));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
    const cx = cv.getContext('2d')!;
    cx.drawImage(source, 0, 0, cv.width, cv.height);
    const d = cx.getImageData(0, 0, cv.width, cv.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
  } catch {}
  return false;
}
