'use client';
// Turns a rendered Studio design into a PNG in the browser: draw it as HTML inside an SVG
// (every image and font inlined as data), paint that onto a canvas, export the canvas.
import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import DesignCanvas, { type StudioBrand } from '@/components/DesignCanvas';
import type { Spec } from './design';

async function toDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => resolve(null); r.readAsDataURL(blob); });
  } catch { return null; }
}

// Google Fonts (or any CSS font link): fetch the CSS and inline each font file.
async function fontCss(urls: string[]) {
  let out = '';
  for (const u of urls) {
    try {
      const css = await (await fetch(u)).text();
      const files = [...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map((m) => m[1]))];
      let inlined = css;
      for (const f of files.slice(0, 12)) { const d = await toDataUrl(f); if (d) inlined = inlined.split(f).join(d); }
      out += inlined + '\n';
    } catch {}
  }
  return out;
}

export async function exportPng(o: { spec: Spec; size: { w: number; h: number }; brand: StudioBrand; srcOf: (id: string) => string | undefined; fonts: string[] }): Promise<Blob> {
  const { spec, size } = o;
  // Inline every picture the design uses.
  const data = new Map<string, string>();
  const ids = [...new Set(spec.layers.filter((l) => l.type === 'image').map((l: any) => l.asset))];
  await Promise.all(ids.map(async (id) => { const s = o.srcOf(id); const d = s ? await toDataUrl(s) : null; if (d) data.set(id, d); }));
  const brand = { ...o.brand };
  if (brand.logo) brand.logo = (await toDataUrl(brand.logo)) || undefined;
  if (brand.logoReversed) brand.logoReversed = (await toDataUrl(brand.logoReversed)) || undefined;
  const css = await fontCss(o.fonts);

  // Render off-screen at the exact size, then serialise it as XHTML.
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none';
  document.body.appendChild(host);
  const root = createRoot(host);
  flushSync(() => root.render(createElement(DesignCanvas, { spec, size, brand, srcOf: (id: string) => data.get(id), px: size.w })));
  await document.fonts?.ready;
  const node = host.firstElementChild as HTMLElement;
  const xhtml = new XMLSerializer().serializeToString(node);
  root.unmount(); host.remove();

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size.w}" height="${size.h}"><foreignObject x="0" y="0" width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml"><style>${css}</style>${xhtml.replace(/^<div xmlns="http:\/\/www.w3.org\/1999\/xhtml"/, '<div')}</div></foreignObject></svg>`;
  const img = new Image();
  img.decoding = 'sync';
  await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error('Couldn’t draw the design.')); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
  const cv = document.createElement('canvas');
  cv.width = size.w; cv.height = size.h;
  cv.getContext('2d')!.drawImage(img, 0, 0, size.w, size.h);
  return await new Promise<Blob>((resolve, reject) => cv.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn’t export the design.'))), 'image/png'));
}
