// The brand kit: one per workspace. Everything Claude needs to build or generate
// on-brand email content. Shared by the web app, the website extractor and the MCP server,
// so it has no server- or browser-only imports.

export type FontSpec = { family: string; fallback: string; weight: number; url: string };

export type BrandKit = {
  name: string;
  website: string;
  // Logo asset ids in this workspace (kind "logo").
  logos: { primary: string | null; reversed: string | null; icon: string | null };
  colors: Record<ColorRole, string | null>;
  dark: Partial<Record<'background' | 'surface' | 'text' | 'link', string | null>>;
  type: {
    heading: FontSpec;
    body: FontSpec;
    sizes: { h1: number; h2: number; body: number; small: number };
    heading_case: 'none' | 'upper' | 'title';
  };
  button: { style: 'filled' | 'outline' | 'underline'; radius: number; padding_y: number; padding_x: number; weight: number; case: 'none' | 'upper' | 'title' };
  layout: { width: number; radius: number; spacing: number };
  imagery: { style: string; references: string[]; do: string[]; dont: string[] };
  voice: { tone: string[]; samples: string[] };
  notes: string;
};

export const COLOR_ROLES = ['primary', 'secondary', 'accent', 'text', 'text_muted', 'background', 'surface', 'border', 'link', 'button_bg', 'button_text'] as const;
export type ColorRole = (typeof COLOR_ROLES)[number];

export const COLOR_LABEL: Record<ColorRole, string> = {
  primary: 'Primary', secondary: 'Secondary', accent: 'Accent', text: 'Text', text_muted: 'Muted text',
  background: 'Background', surface: 'Surface', border: 'Border', link: 'Link', button_bg: 'Button', button_text: 'Button text',
};

export type BrandKitSource = { type: 'website' | 'figma' | 'manual'; url?: string | null; file_key?: string | null; at?: string };
export type BrandKitRow = { workspace_id: string; kit: BrandKit; status: 'draft' | 'approved'; version: number; source: BrandKitSource | null; updated_at?: string; approved_at?: string | null };

export const SANS_FALLBACK = 'Arial, Helvetica, sans-serif';
export const SERIF_FALLBACK = 'Georgia, "Times New Roman", serif';
const SERIF_HINT = /serif|garamond|georgia|times|playfair|merriweather|lora|baskerville|caslon|didot|bodoni|canela|tiempos|freight|recoleta|domaine|editorial|ogg|span/i;

export function emptyKit(name = ''): BrandKit {
  return {
    name,
    website: '',
    logos: { primary: null, reversed: null, icon: null },
    colors: Object.fromEntries(COLOR_ROLES.map((r) => [r, null])) as Record<ColorRole, string | null>,
    dark: {},
    type: {
      heading: { family: '', fallback: SANS_FALLBACK, weight: 700, url: '' },
      body: { family: '', fallback: SANS_FALLBACK, weight: 400, url: '' },
      sizes: { h1: 32, h2: 24, body: 16, small: 13 },
      heading_case: 'none',
    },
    button: { style: 'filled', radius: 4, padding_y: 14, padding_x: 28, weight: 700, case: 'none' },
    layout: { width: 600, radius: 0, spacing: 24 },
    imagery: { style: '', references: [], do: [], dont: [] },
    voice: { tone: [], samples: [] },
    notes: '',
  };
}

// ---------- normalising (everything that comes in: extractor, Claude, the editor) ----------

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const num = (v: unknown, min: number, max: number, dflt: number) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? Math.round(Math.min(max, Math.max(min, n))) : dflt;
};
const oneOf = <T extends string>(v: unknown, opts: readonly T[], dflt: T): T => (opts.includes(v as T) ? (v as T) : dflt);
const list = (v: unknown, n: number, max = 160) => (Array.isArray(v) ? v.map((x) => str(x, max)).filter(Boolean).slice(0, n) : typeof v === 'string' && v.trim() ? [str(v, max)] : []);
const id = (v: unknown) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v.toLowerCase() : null);

// Any CSS colour we can read (#rgb, #rrggbb, #rrggbbaa, rgb()/rgba()) as #rrggbb. Anything else: null.
export function hex(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  let m = s.match(/^#?([0-9a-f]{3})$/);
  if (m) return '#' + m[1].split('').map((c) => c + c).join('');
  m = s.match(/^#?([0-9a-f]{6})([0-9a-f]{2})?$/);
  if (m) return m[2] === '00' ? null : '#' + m[1];
  m = s.match(/^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    if (m[4] !== undefined && parseFloat(m[4]) === 0) return null;
    return '#' + [m[1], m[2], m[3]].map((x) => Math.min(255, +x).toString(16).padStart(2, '0')).join('');
  }
  return null;
}

// First family in a CSS font-family list, without quotes.
export function firstFamily(v: string) {
  return (v.split(',')[0] || '').replace(/["']/g, '').trim();
}

export function fallbackFor(family: string) {
  return SERIF_HINT.test(family) && !/sans/i.test(family) ? SERIF_FALLBACK : SANS_FALLBACK;
}

function font(v: any, dflt: FontSpec): FontSpec {
  const family = firstFamily(str(v?.family, 80)) || dflt.family;
  const url = str(v?.url, 500);
  return {
    family,
    fallback: str(v?.fallback, 120) || (family ? fallbackFor(family) : dflt.fallback),
    weight: num(v?.weight, 100, 900, dflt.weight),
    url: /^https:\/\//.test(url) ? url : '',
  };
}

export function normaliseKit(input: any, name = ''): BrandKit {
  const d = emptyKit(name);
  const k = input && typeof input === 'object' ? input : {};
  const colors = { ...d.colors };
  for (const r of COLOR_ROLES) colors[r] = hex(k.colors?.[r]);
  const dark: BrandKit['dark'] = {};
  for (const r of ['background', 'surface', 'text', 'link'] as const) { const c = hex(k.dark?.[r]); if (c) dark[r] = c; }
  const website = str(k.website, 300);
  return {
    name: str(k.name, 80) || d.name,
    website: /^https?:\/\//.test(website) ? website : '',
    logos: { primary: id(k.logos?.primary), reversed: id(k.logos?.reversed), icon: id(k.logos?.icon) },
    colors,
    dark,
    type: {
      heading: font(k.type?.heading, d.type.heading),
      body: font(k.type?.body, d.type.body),
      sizes: {
        h1: num(k.type?.sizes?.h1, 18, 72, d.type.sizes.h1),
        h2: num(k.type?.sizes?.h2, 14, 56, d.type.sizes.h2),
        body: num(k.type?.sizes?.body, 12, 24, d.type.sizes.body),
        small: num(k.type?.sizes?.small, 10, 18, d.type.sizes.small),
      },
      heading_case: oneOf(k.type?.heading_case, ['none', 'upper', 'title'] as const, 'none'),
    },
    button: {
      style: oneOf(k.button?.style, ['filled', 'outline', 'underline'] as const, d.button.style),
      radius: num(k.button?.radius, 0, 999, d.button.radius),
      padding_y: num(k.button?.padding_y, 4, 40, d.button.padding_y),
      padding_x: num(k.button?.padding_x, 8, 80, d.button.padding_x),
      weight: num(k.button?.weight, 100, 900, d.button.weight),
      case: oneOf(k.button?.case, ['none', 'upper', 'title'] as const, 'none'),
    },
    layout: {
      width: num(k.layout?.width, 480, 800, d.layout.width),
      radius: num(k.layout?.radius, 0, 48, d.layout.radius),
      spacing: num(k.layout?.spacing, 4, 80, d.layout.spacing),
    },
    imagery: {
      style: str(k.imagery?.style, 600),
      references: (Array.isArray(k.imagery?.references) ? k.imagery.references.map(id).filter(Boolean) : []).slice(0, 6) as string[],
      do: list(k.imagery?.do, 8),
      dont: list(k.imagery?.dont, 8),
    },
    voice: { tone: list(k.voice?.tone, 6, 40), samples: list(k.voice?.samples, 5, 200) },
    notes: str(k.notes, 1000),
  };
}

// Deep-ish merge for partial updates: set values win, empty values keep what was there.
export function mergeKit(base: BrandKit, patch: any): BrandKit {
  const p = patch && typeof patch === 'object' ? JSON.parse(JSON.stringify(patch)) : {};
  // A new font family brings its own fallback unless one is given.
  for (const role of ['heading', 'body'] as const) {
    const f = p.type?.[role];
    if (f?.family && !f.fallback) f.fallback = fallbackFor(firstFamily(String(f.family)));
  }
  const pick = (a: any, b: any): any => {
    if (b === undefined || b === null || b === '') return a;
    if (Array.isArray(b)) return b.length ? b : a;
    if (typeof b === 'object' && a && typeof a === 'object' && !Array.isArray(a)) {
      const out: any = { ...a };
      for (const key of Object.keys(b)) out[key] = pick(a[key], b[key]);
      return out;
    }
    return b;
  };
  return normaliseKit(pick(base, p), base.name);
}

// What's still missing, in plain words, for the UI and for Claude.
export function missing(kit: BrandKit): string[] {
  const out: string[] = [];
  if (!kit.logos.primary) out.push('logo');
  if (!kit.colors.primary) out.push('primary colour');
  if (!kit.colors.text) out.push('text colour');
  if (!kit.colors.background) out.push('background colour');
  if (!kit.colors.button_bg && kit.button.style === 'filled') out.push('button colour');
  if (!kit.type.heading.family) out.push('heading font');
  if (!kit.type.body.family) out.push('body font');
  if (!kit.imagery.style && !kit.imagery.references.length) out.push('imagery style');
  return out;
}

// WCAG contrast ratio between two #rrggbb colours.
export function contrast(a: string, b: string) {
  const lum = (h: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

// Checks worth flagging before approval (colour pairs that won't read in an inbox).
export function warnings(kit: BrandKit): string[] {
  const out: string[] = [];
  const c = kit.colors;
  if (c.text && c.background && contrast(c.text, c.background) < 4.5) out.push(`Text on background is low contrast (${contrast(c.text, c.background).toFixed(1)}:1, aim for 4.5).`);
  if (c.button_bg && c.button_text && contrast(c.button_bg, c.button_text) < 4.5) out.push(`Button text on the button colour is low contrast (${contrast(c.button_bg, c.button_text).toFixed(1)}:1).`);
  if (c.link && c.background && contrast(c.link, c.background) < 3) out.push('Links may be hard to see on the background.');
  for (const f of [kit.type.heading, kit.type.body]) if (f.family && !f.url) out.push(`${f.family} has no web font link, so most inboxes will show ${f.fallback.split(',')[0]}.`);
  return [...new Set(out)];
}
