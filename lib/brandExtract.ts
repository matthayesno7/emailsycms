// Reads brand signals out of a website's HTML and CSS, with no browser and no dependencies.
// The result is a set of candidates; Claude (or the heuristic fallback below) turns them into a kit.
import { BrandKit, emptyKit, fallbackFor, firstFamily, hex, normaliseKit } from './brandKit';

export type LogoCandidate = { url?: string; svg?: string; alt?: string; where: string; score: number };

export type Signals = {
  url: string;
  site_name: string;
  title: string;
  description: string;
  theme_color: string | null;
  og_image: string | null;
  icons: { url: string; rel: string; size: number }[];
  logos: LogoCandidate[];
  stylesheets: string[];
  google_fonts: string[];
  css_vars: Record<string, string>;
  colour_counts: [string, number][];
  body: { color: string | null; background: string | null; font: string | null; size: string | null };
  headings: { font: string | null; weight: string | null; transform: string | null; size: string | null };
  links: { color: string | null };
  buttons: { selector: string; background: string | null; color: string | null; radius: string | null; padding: string | null; weight: string | null; transform: string | null; border: string | null }[];
  font_faces: { family: string; url: string | null }[];
};

const attr = (tag: string, name: string) => {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4] ?? '').trim() : '';
};
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const abs = (u: string, base: string) => { try { return new URL(decode(u), base).toString(); } catch { return ''; } };
const meta = (html: string, key: string) => {
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const t = m[0];
    if ((attr(t, 'property') || attr(t, 'name')).toLowerCase() === key) return decode(attr(t, 'content'));
  }
  return '';
};

export function parseHtml(html: string, baseUrl: string) {
  const title = decode((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim());
  const icons: Signals['icons'] = [];
  const stylesheets: string[] = [];
  const google_fonts: string[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const t = m[0], rel = attr(t, 'rel').toLowerCase(), href = abs(attr(t, 'href'), baseUrl);
    if (!href) continue;
    if (/icon/.test(rel)) icons.push({ url: href, rel, size: parseInt(attr(t, 'sizes')) || (/apple/.test(rel) ? 180 : 32) });
    if (/stylesheet/.test(rel) || (/preload/.test(rel) && attr(t, 'as') === 'style')) {
      if (/fonts\.googleapis\.com|use\.typekit\.net|fonts\.bunny\.net/.test(href)) google_fonts.push(href);
      else stylesheets.push(href);
    }
  }
  const inlineCss = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
  for (const m of inlineCss.matchAll(/@import\s+(?:url\()?["']?([^"')\s]+)/g)) {
    const href = abs(m[1], baseUrl);
    if (/fonts\.googleapis\.com|use\.typekit\.net/.test(href)) google_fonts.push(href); else if (href) stylesheets.push(href);
  }

  // Logo candidates: images and inline SVGs near "logo", scored by where they sit.
  const logos: LogoCandidate[] = [];
  const headerEnd = (() => { const i = html.search(/<\/header>/i); return i > 0 ? i : Math.min(html.length, 40000); })();
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const t = m[0];
    const src = attr(t, 'src') || (attr(t, 'srcset').split(/\s+/)[0] || '') || attr(t, 'data-src');
    const hay = [attr(t, 'alt'), attr(t, 'class'), attr(t, 'id'), src].join(' ').toLowerCase();
    const context = html.slice(Math.max(0, m.index! - 300), m.index!).toLowerCase();
    if (!src || src.startsWith('data:image/gif')) continue;
    let score = 0;
    if (/logo|brand|wordmark/.test(hay)) score += 5;
    if (/logo|brand|navbar-brand|site-title/.test(context)) score += 3;
    if (m.index! < headerEnd) score += 2;
    if (/\.svg(\?|$)/i.test(src)) score += 1;
    if (/payment|visa|mastercard|paypal|klarna|trustpilot|partner|press|award|footer/i.test(hay + context.slice(-120))) score -= 6;
    if (score >= 5) logos.push({ url: abs(src, baseUrl), alt: decode(attr(t, 'alt')), where: m.index! < headerEnd ? 'header' : 'page', score });
  }
  for (const m of html.matchAll(/<svg\b[\s\S]*?<\/svg>/gi)) {
    const svg = m[0];
    if (svg.length > 60000 || svg.length < 120) continue;
    const context = html.slice(Math.max(0, m.index! - 300), m.index!).toLowerCase();
    const own = (svg.match(/<svg\b[^>]*>/i)?.[0] || '').toLowerCase() + (svg.match(/<title>([^<]*)/i)?.[1] || '').toLowerCase();
    let score = 0;
    if (/logo|brand|wordmark/.test(own)) score += 5;
    if (/logo|brand|navbar-brand|site-title|aria-label="home"|href="\/"/.test(context)) score += 3;
    if (m.index! < headerEnd) score += 2;
    if (/icon-(cart|search|menu|account|close|chevron)|hamburger/.test(own + context.slice(-120))) score -= 6;
    if (score >= 5) logos.push({ svg: svg.includes('xmlns=') ? svg : svg.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"'), where: m.index! < headerEnd ? 'header' : 'page', score });
  }
  logos.sort((a, b) => b.score - a.score);

  const styleAttrs = [...html.matchAll(/<(?:a|button)\b[^>]*class\s*=\s*["'][^"']*(?:btn|button|cta)[^"']*["'][^>]*style\s*=\s*["']([^"']+)["']/gi)].map((m) => `.inline-button{${m[1]}}`).join('\n');
  return {
    title,
    site_name: meta(html, 'og:site_name') || meta(html, 'application-name') || '',
    description: (meta(html, 'og:description') || meta(html, 'description')).slice(0, 300),
    theme_color: hex(meta(html, 'theme-color')),
    og_image: meta(html, 'og:image') ? abs(meta(html, 'og:image'), baseUrl) : null,
    icons: icons.sort((a, b) => b.size - a.size).slice(0, 6),
    logos: logos.slice(0, 5),
    stylesheets: [...new Set(stylesheets)],
    google_fonts: [...new Set(google_fonts)],
    inlineCss: inlineCss + '\n' + styleAttrs,
  };
}

// ---------- CSS ----------

type Rule = { sel: string; decl: Record<string, string> };

function rules(css: string): Rule[] {
  const out: Rule[] = [];
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@(media|supports|layer|container)[^{]*\{/g, '');
  for (const m of clean.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim().replace(/\s+/g, ' ');
    if (!sel || sel.length > 300) continue;
    const decl: Record<string, string> = {};
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i < 0) continue;
      decl[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).replace(/!important/g, '').trim();
    }
    out.push({ sel, decl });
  }
  return out;
}

export function parseCss(css: string, baseUrl: string) {
  const all = rules(css);
  const vars: Record<string, string> = {};
  for (const r of all) {
    if (!/^(:root|html|body|\*)/.test(r.sel)) continue;
    for (const [k, v] of Object.entries(r.decl)) if (k.startsWith('--') && v.length < 200) vars[k] = v;
  }
  const resolve = (v: string | undefined, depth = 0): string | null => {
    if (!v) return null;
    const m = v.match(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/);
    if (m && depth < 5) return resolve(vars[m[1]] ?? m[2], depth + 1);
    return v.trim();
  };
  const colourOf = (v?: string) => {
    const r = resolve(v);
    if (!r) return null;
    return hex(r) || hex((r.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/i) || [''])[0]);
  };

  // How often each colour is used, weighted towards backgrounds and buttons.
  const counts = new Map<string, number>();
  const bump = (c: string | null, w: number) => { if (c) counts.set(c, (counts.get(c) || 0) + w); };
  for (const r of all) {
    for (const [k, v] of Object.entries(r.decl)) {
      if (!/color|background|fill|border/.test(k) || k.startsWith('--')) continue;
      const w = /btn|button|cta/.test(r.sel) ? 4 : /background/.test(k) ? 2 : 1;
      bump(colourOf(v), w);
    }
  }
  for (const v of Object.values(vars)) bump(colourOf(v), 1);

  const find = (test: (sel: string) => boolean, prop: string) => {
    for (const r of all) if (test(r.sel) && r.decl[prop]) return resolve(r.decl[prop]);
    return null;
  };
  const isBody = (s: string) => /(^|,\s*)(body|html)(\s*,|$)/.test(s);
  const isHeading = (s: string) => /(^|,\s*)h[12](\s*,|$)|\.h[12]\b|heading|title/.test(s) && !/sub/.test(s);

  const buttons: Signals['buttons'] = [];
  for (const r of all) {
    if (!/(^|[\s,.])(btn|button|cta)[\w-]*|(^|,\s*)button(\s*,|$)|\[type=.?submit/.test(r.sel)) continue;
    if (/:hover|:focus|:active|disabled|close|icon|search|menu|toggle|slick|swiper|carousel|arrow/.test(r.sel)) continue;
    const bg = colourOf(r.decl['background-color'] || r.decl['background']);
    if (!bg && !r.decl['border-radius']) continue;
    buttons.push({
      selector: r.sel.slice(0, 80),
      background: bg,
      color: colourOf(r.decl['color']),
      radius: resolve(r.decl['border-radius']),
      padding: resolve(r.decl['padding']),
      weight: resolve(r.decl['font-weight']),
      transform: resolve(r.decl['text-transform']),
      border: resolve(r.decl['border']),
    });
    if (buttons.length >= 8) break;
  }

  const font_faces: Signals['font_faces'] = [];
  for (const m of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const fam = m[1].match(/font-family\s*:\s*([^;]+)/i)?.[1];
    const src = m[1].match(/url\(\s*["']?([^"')]+\.woff2?[^"')]*)/i)?.[1];
    if (fam) font_faces.push({ family: firstFamily(fam), url: src ? abs(src, baseUrl) : null });
  }

  return {
    vars,
    counts,
    buttons,
    font_faces,
    body: { color: colourOf(find(isBody, 'color') || undefined), background: colourOf(find(isBody, 'background-color') || find(isBody, 'background') || undefined), font: find(isBody, 'font-family'), size: find(isBody, 'font-size') },
    headings: { font: find(isHeading, 'font-family'), weight: find(isHeading, 'font-weight'), transform: find(isHeading, 'text-transform'), size: find((s) => /(^|,\s*)h1(\s*,|$)/.test(s), 'font-size') },
    links: { color: colourOf(find((s) => /(^|,\s*)a(\s*,|$|:link)/.test(s), 'color') || undefined) },
  };
}

// Colour/font variables worth showing Claude (named like brand, primary, text, font…).
function usefulVars(vars: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(vars)) {
    if (!/color|colour|brand|primary|secondary|accent|text|bg|background|font|family|radius|button|btn|link/i.test(k)) continue;
    if (/shadow|transition|z-index|duration|ease|breakpoint|gutter|grid/i.test(k)) continue;
    out[k] = v;
    if (Object.keys(out).length >= 60) break;
  }
  return out;
}

export function combine(url: string, html: ReturnType<typeof parseHtml>, css: ReturnType<typeof parseCss>): Signals {
  const neutral = (c: string) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)); return Math.max(r, g, b) - Math.min(r, g, b) < 12; };
  return {
    url,
    site_name: html.site_name,
    title: html.title,
    description: html.description,
    theme_color: html.theme_color,
    og_image: html.og_image,
    icons: html.icons,
    logos: html.logos,
    stylesheets: html.stylesheets.slice(0, 6),
    google_fonts: html.google_fonts,
    css_vars: usefulVars(css.vars),
    colour_counts: [...css.counts.entries()].sort((a, b) => b[1] - a[1] - (neutral(b[0]) ? 0.5 : 0) + (neutral(a[0]) ? 0.5 : 0)).slice(0, 24),
    body: css.body,
    headings: css.headings,
    links: css.links,
    buttons: css.buttons,
    font_faces: css.font_faces.filter((f, i, a) => a.findIndex((x) => x.family === f.family) === i).slice(0, 10),
  };
}

// Web font link for a family: Google Fonts CSS the site already loads, else the site's own @font-face file.
function fontUrl(family: string, s: Signals) {
  if (!family) return '';
  const g = s.google_fonts.find((u) => u.toLowerCase().includes(family.toLowerCase().replace(/\s+/g, '+')) || u.toLowerCase().includes(family.toLowerCase().replace(/\s+/g, '%20')));
  if (g) return g.startsWith('https://') ? g : '';
  return '';
}

// No Claude available: a sensible first guess from the signals alone.
export function heuristicKit(s: Signals, name: string): BrandKit {
  const k = emptyKit(name);
  const sat = (c: string) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)); return Math.max(r, g, b) - Math.min(r, g, b); };
  const brandy = s.colour_counts.map(([c]) => c).filter((c) => sat(c) > 40);
  const btn = s.buttons.find((b) => b.background && sat(b.background) > 20) || s.buttons.find((b) => b.background);
  k.website = s.url;
  k.colors.primary = s.theme_color && sat(s.theme_color) > 20 ? s.theme_color : btn?.background || brandy[0] || null;
  k.colors.secondary = brandy.find((c) => c !== k.colors.primary) || null;
  k.colors.text = s.body.color || '#1d1d1f';
  k.colors.background = s.body.background || '#ffffff';
  k.colors.link = s.links.color || k.colors.primary;
  k.colors.button_bg = btn?.background || k.colors.primary;
  k.colors.button_text = btn?.color || (k.colors.button_bg ? '#ffffff' : null);
  const body = firstFamily(s.body.font || ''), head = firstFamily(s.headings.font || '') || body;
  if (body) k.type.body = { family: body, fallback: fallbackFor(body), weight: 400, url: fontUrl(body, s) };
  if (head) k.type.heading = { family: head, fallback: fallbackFor(head), weight: parseInt(s.headings.weight || '') || 700, url: fontUrl(head, s) };
  if (/upper/.test(s.headings.transform || '')) k.type.heading_case = 'upper';
  if (btn) {
    k.button.radius = parseInt(btn.radius || '') || 0;
    const pad = (btn.padding || '').match(/(\d+(?:\.\d+)?)px(?:\s+(\d+(?:\.\d+)?)px)?/);
    if (pad) { k.button.padding_y = Math.round(+pad[1]); k.button.padding_x = Math.round(+(pad[2] || pad[1])); }
    if (/upper/.test(btn.transform || '')) k.button.case = 'upper';
    if (btn.weight) k.button.weight = parseInt(btn.weight) || 700;
  }
  return normaliseKit(k, name);
}

export const KIT_PROMPT = `You are setting up an email brand kit from signals scraped from a brand's website.
Return ONLY a JSON object with this shape (omit what you can't tell; never invent fonts or colours that aren't in the signals):
{
  "name": string,
  "colors": { "primary","secondary","accent","text","text_muted","background","surface","border","link","button_bg","button_text": "#rrggbb" },
  "dark": { "background","text": "#rrggbb" }   // only if the site defines a dark theme
  "type": {
    "heading": { "family": string, "weight": number, "url": string },   // url: a Google Fonts css link from the signals, else ""
    "body":    { "family": string, "weight": number, "url": string },
    "sizes": { "h1": number, "h2": number, "body": number, "small": number },   // email sizes in px (body 14-18, h1 26-40)
    "heading_case": "none"|"upper"|"title"
  },
  "button": { "style": "filled"|"outline"|"underline", "radius": number, "padding_y": number, "padding_x": number, "weight": number, "case": "none"|"upper"|"title" },
  "imagery": { "style": string, "do": [string], "dont": [string] },   // from the attached image, if any: 1-2 sentences on photography style, 2-4 short rules each
  "voice": { "tone": [string] }   // 2-4 words from the site's own copy
}
Rules: primary is the brand's signature colour (logo, buttons, theme-color), not black or white unless the brand is monochrome. button_bg/button_text come from the main call-to-action button. text must read on background. Prefer named CSS variables (--brand-*, --color-primary) over raw frequency. Ignore colours from third-party widgets (cookie banners, chat, payment badges). Families: the first real family in the stack, not generic names like sans-serif or system-ui.`;
