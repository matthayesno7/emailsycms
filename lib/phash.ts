'use client';
// Near-duplicate detection: a 64-bit difference hash (dHash) of a picture. Two copies of the
// same image (resized, recompressed, slightly cropped or brightened) differ by only a few bits.

export function dhash(src: HTMLImageElement | HTMLCanvasElement): string | null {
  try {
    const cv = document.createElement('canvas');
    cv.width = 9; cv.height = 8;
    const cx = cv.getContext('2d', { willReadFrequently: true })!;
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, 9, 8); // transparent areas count as white
    cx.drawImage(src, 0, 0, 9, 8);
    const d = cx.getImageData(0, 0, 9, 8).data;
    const g = (x: number, y: number) => { const o = (y * 9 + x) * 4; return d[o] * 0.299 + d[o + 1] * 0.587 + d[o + 2] * 0.114; };
    let hex = '';
    for (let y = 0; y < 8; y++) {
      let byte = 0;
      for (let x = 0; x < 8; x++) byte = (byte << 1) | (g(x, y) > g(x + 1, y) ? 1 : 0);
      hex += byte.toString(16).padStart(2, '0');
    }
    return hex;
  } catch {
    return null; // e.g. a cross-origin image the canvas can't read
  }
}

export function hamming(a: string, b: string) {
  if (!a || !b || a.length !== b.length) return 64;
  let n = 0;
  for (let i = 0; i < a.length; i += 2) {
    let x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16);
    while (x) { n += x & 1; x >>= 1; }
  }
  return n;
}

// Close enough to call a copy. Flat or near-blank images (all bits equal) are ignored:
// every plain white graphic would otherwise "match" every other.
export const DUP_BITS = 5;
const flat = (h: string) => /^(0+|f+)$/.test(h);

// The earliest-added asset this hash matches, if any.
export function findDuplicate<T extends { id: string; phash?: string | null; created_at?: string; kind?: string }>(hash: string, items: T[], self?: { id?: string; created_at?: string }) {
  if (!hash || flat(hash)) return null;
  let best: T | null = null;
  for (const o of items) {
    if (!o.phash || o.phash === '-' || o.id === self?.id || o.kind === 'block') continue;
    if (self?.created_at && o.created_at && o.created_at > self.created_at) continue;
    if (hamming(hash, o.phash) <= DUP_BITS && (!best || String(o.created_at) < String(best.created_at))) best = o;
  }
  return best;
}
