'use client';
// Asks the server for AI alt text. Returns null when the feature isn't set up or fails.
import { toBase64Jpeg } from './images';

export async function suggestAlt(img: HTMLImageElement): Promise<string | null> {
  try {
    const { data } = toBase64Jpeg(img, 1024);
    const res = await fetch('/api/alt-text', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image: data }) });
    if (!res.ok) return null;
    const json = await res.json();
    return json.alt || null;
  } catch {
    return null;
  }
}
