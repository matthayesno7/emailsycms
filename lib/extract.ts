'use client';
// Turn a finished design (one flat image) into an editable Card block:
// Claude reads the copy and finds the photo, then we crop the photo out of the original.
import type { SupabaseClient } from '@supabase/supabase-js';
import { BLOCK_TYPES, exportSize } from './blockTypes';
import { cropCanvas, drawFit, toBase64Jpeg, toBlob } from './images';

export type Reading = {
  is_design: boolean;
  layout: 'top' | 'left' | 'right';
  photo: { x: number; y: number; width: number; height: number } | null;
  eyebrow: string; headline: string; rating: number; body: string; name: string; cta: string;
};

export type ReadResult =
  | { ok: true; reading: Reading; crop: { x: number; y: number; w: number; h: number } | null }
  | { ok: false; reason: 'not_configured' | 'not_a_design' | 'error'; message?: string };

const clamp = (v: number) => Math.min(1, Math.max(0, v));

export async function readDesign(img: HTMLImageElement, workspaceId: string): Promise<ReadResult> {
  const { data, width, height } = toBase64Jpeg(img);
  let res: Response;
  try {
    res = await fetch('/api/extract-design', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ workspace_id: workspaceId, image: data, width, height }),
    });
  } catch {
    return { ok: false, reason: 'error', message: 'Network error' };
  }
  if (res.status === 501) return { ok: false, reason: 'not_configured' };
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.result) return { ok: false, reason: 'error', message: json.error };
  const r = json.result as Reading;
  if (!r.is_design) return { ok: false, reason: 'not_a_design' };
  let crop: { x: number; y: number; w: number; h: number } | null = null;
  if (r.photo && r.photo.width > 4 && r.photo.height > 4) {
    const x = clamp(r.photo.x / width), y = clamp(r.photo.y / height);
    crop = { x, y, w: Math.min(1 - x, r.photo.width / width), h: Math.min(1 - y, r.photo.height / height) };
  }
  return { ok: true, reading: r, crop };
}

// Build the Card's fields and images. Uploads the cropped photo; the original stays as the reference.
export async function cardFromReading(opts: {
  supabase: SupabaseClient; ws: string; img: HTMLImageElement; originalPath: string;
  reading: Reading; crop: { x: number; y: number; w: number; h: number } | null;
}) {
  const { supabase, ws, img, originalPath, reading: r, crop } = opts;
  const layout = ['top', 'left', 'right'].includes(r.layout) ? r.layout : 'top';
  const fields = {
    layout,
    eyebrow: (r.eyebrow || '').trim(),
    headline: (r.headline || '').trim(),
    rating: r.rating ? String(Math.min(5, Math.max(1, Math.round(r.rating)))) : '',
    body: (r.body || '').trim().replace(/^["“]|["”]$/g, ''),
    name: (r.name || '').trim(),
    cta: (r.cta || '').trim(),
    link: '',
  };
  const images: Record<string, any> = {
    reference: { path: originalPath, width: img.naturalWidth, height: img.naturalHeight, note: 'Original design' },
  };
  if (crop) {
    const d = BLOCK_TYPES.card.fields.find((f) => f.type === 'image')!;
    const src = cropCanvas(img, crop);
    const { w, h } = exportSize(d, src.width, src.height, layout);
    const blob = await toBlob(drawFit(src, w, h, 'cover', null, true), 'image/jpeg', 0.88);
    const path = `${ws}/blocks/${crypto.randomUUID()}.jpg`;
    const { error } = await supabase.storage.from('assets').upload(path, blob, { contentType: 'image/jpeg' });
    if (error) throw error;
    images.image = { path, width: w, height: h, format: 'jpg', bytes: blob.size, alt: fields.headline || fields.name || '', original_path: originalPath, crop };
  }
  return { block_type: 'card', fields, images };
}
