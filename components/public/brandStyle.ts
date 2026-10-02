// Turns a brand kit into the look of a public page: CSS variables and font links.
// Zero setup: whatever the kit has is used, with readable fallbacks for anything missing.
import type { BrandKit, FontSpec } from '@/lib/brandKit';

function lum(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const n = parseInt(m[1], 16), c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrast(a: string, b: string) {
  const x = lum(a), y = lum(b);
  if (x == null || y == null) return 1;
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
// The colour if it reads well on the background, otherwise near-black or white.
const readable = (fg: string | null | undefined, bg: string, min = 4.5) => (fg && contrast(fg, bg) >= min ? fg : (lum(bg) ?? 1) > 0.4 ? '#141414' : '#ffffff');

// Everything below ends up inside a <style> tag, so only safe characters get through.
const hx = (v?: string | null) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim() : null);
const fam = (v?: string | null) => (v || '').replace(/[^\w\s-]/g, '').trim().slice(0, 60);
const fallback = (v?: string | null) => (v || '').replace(/[^\w\s,"-]/g, '').trim().slice(0, 120) || 'system-ui, sans-serif';
const cssUrl = (u: string) => u.replace(/[<>"'()\s\\]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));

function family(f?: FontSpec) {
  const name = fam(f?.family);
  if (!name) return '';
  return `'${name}', ${fallback(f?.fallback)}`;
}

export function brandVars(kit: BrandKit | null) {
  const raw = kit?.colors || ({} as BrandKit['colors']);
  const c = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, hx(v as string)])) as BrandKit['colors'];
  const bg = c.background && lum(c.background) != null ? c.background : '#ffffff';
  const primary = c.primary || '#141414';
  const btnBg = c.button_bg || primary;
  const vars: Record<string, string> = {
    '--b-bg': bg,
    '--b-surface': c.surface && contrast(c.surface, bg) < 1.6 ? c.surface : (lum(bg) ?? 1) > 0.4 ? '#f5f5f3' : '#1d1d1d',
    '--b-text': readable(c.text, bg),
    '--b-muted': readable(c.text_muted, bg, 3),
    '--b-border': c.border || ((lum(bg) ?? 1) > 0.4 ? '#e7e5e1' : '#333333'),
    '--b-primary': primary,
    '--b-accent': readable(c.link || primary, bg, 3),
    '--b-btn-bg': btnBg,
    '--b-btn-text': readable(c.button_text, btnBg),
    '--b-radius': `${Math.min(24, kit?.button?.radius ?? 6)}px`,
    '--b-head': family(kit?.type?.heading) || 'Figtree, system-ui, sans-serif',
    '--b-body': family(kit?.type?.body) || 'Figtree, system-ui, sans-serif',
  };
  return Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';');
}

// Stylesheets or @font-face rules for the kit's fonts. Families without a link are tried on Google Fonts.
export function fontAssets(kit: BrandKit | null): { links: string[]; css: string } {
  const links = new Set<string>(); let css = '';
  for (const f of [kit?.type?.heading, kit?.type?.body]) {
    const name = fam(f?.family);
    if (!f || !name) continue;
    const url = /^https:\/\//.test(f.url || '') ? f.url : '';
    if (/fonts\.googleapis\.com\/css|\.css(\?|$)/.test(url)) links.add(url);
    else if (/\.(woff2?|ttf|otf)(\?|$)/i.test(url)) css += `@font-face{font-family:'${name}';src:url('${cssUrl(url)}');font-weight:${Math.round(Number(f.weight) || 400)};font-display:swap}`;
    else if (!url) links.add(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, '+')}&display=swap`);
  }
  return { links: [...links], css };
}
