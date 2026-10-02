// Colour helpers shared by the tagger, search and the UI. No browser- or server-only imports.
import { COLOR_ROLES, COLOR_LABEL, type BrandKit, type ColorRole } from './brandKit';

export function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// CIE Lab, so "nearest colour" matches what people see rather than raw RGB distance.
function lab([r, g, b]: [number, number, number]) {
  const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const R = lin(r), G = lin(g), B = lin(b);
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047), y = f(R * 0.2126 + G * 0.7152 + B * 0.0722), z = f((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

export function distance(a: string, b: string) {
  const ra = rgb(a), rb = rgb(b);
  if (!ra || !rb) return Infinity;
  const la = lab(ra), lb = lab(rb);
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

// The brand-kit colour each found colour is closest to, when it's close enough to count (ΔE under 18).
export type BrandMatch = { hex: string; role: ColorRole | null; label: string | null; brand_hex: string | null; delta: number | null };
export function matchBrand(colours: string[], kit: BrandKit | null | undefined): BrandMatch[] {
  const roles = COLOR_ROLES.filter((r) => kit?.colors?.[r]).map((r) => ({ role: r, hex: kit!.colors[r] as string }));
  return colours.map((hex) => {
    let best: { role: ColorRole; hex: string; d: number } | null = null;
    for (const r of roles) { const d = distance(hex, r.hex); if (!best || d < best.d) best = { ...r, d }; }
    return best && best.d < 18
      ? { hex, role: best.role, label: COLOR_LABEL[best.role], brand_hex: best.hex, delta: Math.round(best.d) }
      : { hex, role: null, label: null, brand_hex: null, delta: null };
  });
}

// A plain name people would search for ("red product shots", "navy background").
export function colourName(hex: string): string | null {
  const c = rgb(hex);
  if (!c) return null;
  const [r, g, b] = c.map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (l < 0.13) return 'black';
  if (l > 0.93 && s < 0.5) return 'white';
  if (s < 0.12) return l > 0.65 ? 'light grey' : l < 0.3 ? 'charcoal' : 'grey';
  if (h >= 20 && h < 65 && l > 0.78 && s < 0.75 && !(h < 40 && s > 0.6)) return 'beige';
  if (h < 15 || h >= 345) return l < 0.3 ? 'burgundy' : l > 0.75 ? 'pink' : 'red';
  if (h < 40) return l < 0.35 ? 'brown' : s < 0.45 && l > 0.6 ? 'beige' : l > 0.8 ? 'peach' : 'orange';
  if (h < 65) return s < 0.45 && l > 0.6 ? 'beige' : l < 0.35 ? 'olive' : 'yellow';
  if (h < 160) return l < 0.25 ? 'dark green' : 'green';
  if (h < 195) return 'teal';
  if (h < 250) return l < 0.3 ? 'navy' : l > 0.75 ? 'light blue' : 'blue';
  if (h < 290) return 'purple';
  return l > 0.7 ? 'pink' : 'magenta';
}

export function colourNames(colours: string[]) {
  return [...new Set(colours.map(colourName).filter(Boolean) as string[])];
}
