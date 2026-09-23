'use client';
// Client-side image helpers: load, crop to email sizes, cut out white backgrounds.

export function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = 'anonymous';
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = src;
  });
}

export function dimsOf(file: Blob): Promise<{ w: number | null; h: number | null }> {
  const url = URL.createObjectURL(file);
  return loadImg(url)
    .then((i) => ({ w: i.naturalWidth, h: i.naturalHeight }))
    .catch(() => ({ w: null, h: null }))
    .finally(() => URL.revokeObjectURL(url));
}

// Flood-fill near-white from the edges to transparent (product packshots on white).
export function cutWhite(img: HTMLImageElement): HTMLCanvasElement {
  const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const cx = cv.getContext('2d')!;
  cx.drawImage(img, 0, 0, w, h);
  const d = cx.getImageData(0, 0, w, h), p = d.data, seen = new Uint8Array(w * h), st: number[] = [];
  const white = (i: number) => { const o = i * 4; return p[o + 3] > 0 && p[o] > 232 && p[o + 1] > 232 && p[o + 2] > 232; };
  for (let x = 0; x < w; x++) st.push(x, x + (h - 1) * w);
  for (let y = 0; y < h; y++) st.push(y * w, y * w + w - 1);
  while (st.length) {
    const i = st.pop()!;
    if (seen[i]) continue;
    seen[i] = 1;
    if (!white(i)) continue;
    p[i * 4 + 3] = 0;
    const x = i % w, y = (i / w) | 0;
    if (x > 0) st.push(i - 1);
    if (x < w - 1) st.push(i + 1);
    if (y > 0) st.push(i - w);
    if (y < h - 1) st.push(i + w);
  }
  cx.putImageData(d, 0, 0);
  return cv;
}

type Src = HTMLImageElement | HTMLCanvasElement;
const sizeOf = (s: Src) => ({ w: (s as HTMLImageElement).naturalWidth || s.width, h: (s as HTMLImageElement).naturalHeight || s.height });

// Draw a source into a target size. cover = crop around the focal point; contain = fit inside.
export function drawFit(src: Src, tw: number, th: number, fit: 'cover' | 'contain', focus?: { x: number; y: number } | null, opaque = false, pad = 1) {
  const cv = document.createElement('canvas');
  cv.width = tw; cv.height = th;
  const cx = cv.getContext('2d')!;
  const { w: sw, h: sh } = sizeOf(src);
  if (opaque) { cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, tw, th); }
  if (fit === 'contain') {
    const s = Math.min(tw / sw, th / sh) * pad, dw = sw * s, dh = sh * s;
    cx.drawImage(src, (tw - dw) / 2, (th - dh) / 2, dw, dh);
  } else {
    const f = focus || { x: 0.5, y: 0.5 };
    const s = Math.max(tw / sw, th / sh), cw = tw / s, ch = th / s;
    const sx = Math.min(Math.max(f.x * sw - cw / 2, 0), sw - cw), sy = Math.min(Math.max(f.y * sh - ch / 2, 0), sh - ch);
    cx.drawImage(src, sx, sy, cw, ch, 0, 0, tw, th);
  }
  return cv;
}

export function toBlob(cv: HTMLCanvasElement, type = 'image/png', quality = 0.86): Promise<Blob> {
  return new Promise((resolve, reject) => cv.toBlob((b) => (b ? resolve(b) : reject(new Error('export failed'))), type, quality));
}

export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}

export const extOf = (file: File) => {
  const m = /\.([a-z0-9]+)$/i.exec(file.name || '');
  if (m) return m[1].toLowerCase().replace('jpeg', 'jpg');
  return file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : file.type === 'image/gif' ? 'gif' : file.type === 'image/svg+xml' ? 'svg' : 'jpg';
};
export const baseName = (n: string) => n.replace(/\.[^.]+$/, '');
