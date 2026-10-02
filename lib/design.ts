// Mise Studio: Claude designs on the page. It answers with a small layout spec in a fixed
// vocabulary; our renderer draws it with the brand kit's own colours, fonts and buttons and the
// workspace's real images. The spec can't use off-brand colours or fonts, which keeps every
// variant on brand, and it's small, so designs arrive in seconds.

export const COLOR_ROLES = ['primary', 'secondary', 'accent', 'text', 'text_muted', 'background', 'surface', 'button_bg', 'button_text', 'white', 'black'] as const;
export type Role = (typeof COLOR_ROLES)[number];
export type TextRole = 'headline' | 'subhead' | 'body' | 'eyebrow' | 'price';

export type Layer =
  | { type: 'image'; asset: string; x: number; y: number; w: number; h: number; fit: 'cover' | 'contain'; radius: number; shade: number; focus?: { x: number; y: number } }
  | { type: 'rect'; x: number; y: number; w: number; h: number; fill: Role; radius: number; opacity: number; stroke?: Role; stroke_w?: number }
  | { type: 'text'; role: TextRole; text: string; x: number; y: number; w: number; size: number; color: Role; align: 'left' | 'center' | 'right'; weight: number; upper: boolean }
  | { type: 'button'; text: string; x: number; y: number; size: number; align: 'left' | 'center' | 'right'; tone: 'brand' | 'light' }
  | { type: 'logo'; variant: 'primary' | 'reversed'; x: number; y: number; h: number; align: 'left' | 'center' | 'right' };

export type Spec = { name: string; background: Role; layers: Layer[]; note?: string };
export type Size = { w: number; h: number };

export const FORMATS: { id: string; label: string; w: number; h: number; video?: boolean; hint: string }[] = [
  { id: 'email-hero', label: 'Email hero', w: 1200, h: 600, hint: 'email hero banner (shown at 600px wide in inboxes)' },
  { id: 'linkedin-banner', label: 'LinkedIn banner', w: 1128, h: 191, hint: 'LinkedIn company page banner; keep the left 25% clear where the profile picture overlaps' },
  { id: 'linkedin-post', label: 'LinkedIn post', w: 1200, h: 627, hint: 'LinkedIn feed image' },
  { id: 'ig-post', label: 'Instagram post', w: 1080, h: 1350, hint: 'Instagram feed post, portrait' },
  { id: 'story', label: 'Story', w: 1080, h: 1920, hint: 'Instagram/Facebook story; keep the top 12% and bottom 18% free of key text' },
  { id: 'square', label: 'Square ad', w: 1080, h: 1080, hint: 'square social ad' },
  { id: 'reel', label: 'Product reel', w: 1080, h: 1920, video: true, hint: 'short vertical video' },
  { id: 'animated', label: 'Animated banner', w: 1200, h: 600, video: true, hint: 'animated email banner' },
];

export const DIRECTIONS = [
  'Image-led: a full-bleed photo with the copy set over it (add a shade so text reads), minimal and confident.',
  'Split layout: photo on one side, a solid brand-colour panel with the copy on the other.',
  'Type-led: a bold headline on a brand colour or the background, with the product or photo smaller as a supporting element.',
  'Editorial: generous white space, an eyebrow line, elegant hierarchy, the photo framed like a magazine.',
];

export type LibraryItem = { id: string; kind: string; name: string; alt?: string; w?: number | null; h?: number | null; pid?: string | null; price?: string | null };

export function systemPrompt() {
  return `You are the design engine of Mise Studio. You design one marketing graphic at a time as a JSON layout spec that our renderer draws with the brand's own colours, fonts, logo and photos.

Return ONLY a JSON object:
{
  "name": short name for the design (3-6 words),
  "background": colour role,
  "layers": [ ... drawn in order, first is at the back ... ],
  "note": one short sentence on the idea (optional)
}

Coordinates: x, y, w, h are percentages of the canvas width (x, w) and height (y, h), 0-100. Text and button "size" is the font size as a percentage of the canvas WIDTH (e.g. on a 1200px-wide canvas, size 5 = 60px). Think about the canvas's real proportions: on a very wide, short canvas, sizes must be small; on a tall canvas, larger.

Layer types:
- {"type":"image","asset":"<id from the library>","x","y","w","h","fit":"cover"|"contain","radius":0-40,"shade":0-0.7}  shade darkens towards the bottom so white text reads over it. Use "contain" for product cut-outs and logos-in-context, "cover" for photos.
- {"type":"rect","x","y","w","h","fill":role,"radius":0-40,"opacity":0-1,"stroke":role (optional outline),"stroke_w":0.05-1 (outline width, % of canvas width)}  for an outlined box with no fill, use opacity 0 and a stroke.
- {"type":"text","role":"headline"|"subhead"|"body"|"eyebrow"|"price","text","x","y","w","size","color":role,"align":"left"|"center"|"right","weight":400-900,"upper":bool}  y is the top of the text box; it wraps within w.
- {"type":"button","text","x","y","size","align","tone":"brand"|"light"}  drawn in the brand's button style; x,y is its left (or centre/right, per align) and top. tone "light" is a white button for dark photos or panels in the button colour; "brand" everywhere else. The button must stand out from what's behind it.
- {"type":"logo","variant":"primary"|"reversed","x","y","h","align"}  reversed is for dark backgrounds or photos.

Colour roles only (never hex): primary, secondary, accent, text, text_muted, background, surface, button_bg, button_text, white, black.

Design rules:
- One clear idea. Headline 2-7 words, in the brand's voice. At most one button. Eyebrow short (1-3 words).
- Strong hierarchy: headline clearly biggest. Keep a 5-7% safe margin from every edge.
- Text over a photo needs a shade (0.35-0.6) or a solid panel behind it; never put text where it won't read.
- Use the brand's real photos and products from the library; pick the one that best fits the brief. Use the logo once, small.
- Don't make text overlap other text. Leave breathing room.
- Only use asset ids from the library list. If the library has no suitable photo, design type-led with brand colours.`;
}

export function userPrompt(o: { brand: string; kit: any; library: LibraryItem[]; brief: string; size: Size; formatHint?: string; direction?: string; base?: Spec | null; instruction?: string | null }) {
  const lib = o.library.map((a) => ({ id: a.id, kind: a.kind, name: a.name, ...(a.alt ? { alt: a.alt } : {}), ...(a.w && a.h ? { shape: `${a.w}×${a.h}` } : {}), ...(a.pid ? { pid: a.pid } : {}), ...(a.price ? { price: a.price } : {}) }));
  const kit = o.kit ? {
    colors: o.kit.colors, heading_case: o.kit.type?.heading_case, button_style: o.kit.button?.style,
    imagery: o.kit.imagery?.style, voice: o.kit.voice?.tone, notes: o.kit.notes,
  } : null;
  const parts = [
    `Brand: ${o.brand}`,
    kit ? `Brand kit: ${JSON.stringify(kit)}` : 'No brand kit yet: use the roles anyway, they have sensible defaults.',
    `Canvas: ${o.size.w}×${o.size.h}px${o.formatHint ? ` (${o.formatHint})` : ''}.`,
    `Library (photos, products, logos): ${JSON.stringify(lib)}`,
    `Brief: ${o.brief}`,
  ];
  if (o.base && o.instruction) parts.push(`Current design: ${JSON.stringify(o.base)}\nChange it: ${o.instruction}\nKeep everything else as it is unless the change needs it.`);
  else if (o.base) parts.push(`Current design (made for another size): ${JSON.stringify(o.base)}\nAdapt it to this canvas: same idea, copy and images, re-laid out so it works at these proportions.`);
  else if (o.direction) parts.push(`Direction for this variant: ${o.direction}`);
  return parts.join('\n\n');
}

// ---------- validation: whatever comes back, draw only what's safe ----------
const n = (v: any, lo: number, hi: number, d: number) => { const x = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };
const role = (v: any, d: Role): Role => (COLOR_ROLES.includes(v) ? v : d);
const al = (v: any): 'left' | 'center' | 'right' => (v === 'center' || v === 'right' ? v : 'left');
const str = (v: any, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

export function cleanSpec(input: any, allowed: Set<string>): Spec | null {
  if (!input || typeof input !== 'object' || !Array.isArray(input.layers)) return null;
  const layers: Layer[] = [];
  for (const l of input.layers.slice(0, 40)) {
    if (!l || typeof l !== 'object') continue;
    if (l.type === 'image' && allowed.has(String(l.asset))) {
      layers.push({ type: 'image', asset: String(l.asset), x: n(l.x, -10, 100, 0), y: n(l.y, -10, 100, 0), w: n(l.w, 1, 120, 100), h: n(l.h, 1, 120, 100), fit: l.fit === 'contain' ? 'contain' : 'cover', radius: n(l.radius, 0, 40, 0), shade: n(l.shade, 0, 0.8, 0), ...(l.focus ? { focus: { x: n(l.focus.x, 0, 1, .5), y: n(l.focus.y, 0, 1, .5) } } : {}) });
    } else if (l.type === 'rect') {
      layers.push({ type: 'rect', x: n(l.x, -10, 100, 0), y: n(l.y, -10, 100, 0), w: n(l.w, 0, 120, 10), h: n(l.h, 0, 120, 10), fill: role(l.fill, 'primary'), radius: n(l.radius, 0, 40, 0), opacity: n(l.opacity, 0, 1, 1), ...(COLOR_ROLES.includes(l.stroke) ? { stroke: l.stroke as Role, stroke_w: n(l.stroke_w, 0.05, 1, 0.15) } : {}) });
    } else if (l.type === 'text' && str(l.text, 220)) {
      const r: TextRole = ['headline', 'subhead', 'body', 'eyebrow', 'price'].includes(l.role) ? l.role : 'body';
      layers.push({ type: 'text', role: r, text: str(l.text, 220), x: n(l.x, 0, 100, 6), y: n(l.y, 0, 100, 6), w: n(l.w, 5, 100, 60), size: n(l.size, 0.8, 20, r === 'headline' ? 6 : 2.4), color: role(l.color, 'text'), align: al(l.align), weight: n(l.weight, 300, 900, r === 'headline' ? 700 : 400), upper: !!l.upper });
    } else if (l.type === 'button' && str(l.text, 30)) {
      layers.push({ type: 'button', text: str(l.text, 30), x: n(l.x, 0, 100, 6), y: n(l.y, 0, 100, 80), size: n(l.size, 0.6, 8, 1.8), align: al(l.align), tone: l.tone === 'light' ? 'light' : 'brand' });
    } else if (l.type === 'logo') {
      layers.push({ type: 'logo', variant: l.variant === 'reversed' ? 'reversed' : 'primary', x: n(l.x, 0, 100, 6), y: n(l.y, 0, 100, 6), h: n(l.h, 1, 30, 6), align: al(l.align) });
    }
  }
  if (!layers.length) return null;
  return { name: str(input.name, 60) || 'Untitled design', background: role(input.background, 'background'), layers, ...(str(input.note, 200) ? { note: str(input.note, 200) } : {}) };
}

// Turning a finished picture (made in Figma, or uploaded) into an editable layout: Claude looks at
// it and rebuilds it in the Studio's vocabulary, using the library's real photos and logo.
export function rebuildBrief(sourceIds: string[]) {
  return [
    'Rebuild the attached image as an editable layout, as faithfully as you can. This is not a redesign.',
    '- Every piece of text word for word, with the same case, position, size, weight and alignment. Separate lines or blocks of text become separate text layers.',
    '- Colours: the nearest brand colour role.',
    `- Photos and backgrounds: use the matching library asset${sourceIds.length ? ` (it was made from ${sourceIds.join(', ')}; use those)` : ''}. Never use a picture that already contains this design's text. If no library photo matches, use a rect in the closest colour.`,
    '- Panels, cards, pills and bars: rect layers (outlined boxes: opacity 0 with a stroke). Logo: a logo layer.',
    '- Up to 40 layers. Name it after its headline.',
  ].join('\n');
}

export function assetsUsed(s: Spec) {
  return [...new Set(s.layers.filter((l) => l.type === 'image').map((l: any) => l.asset as string))];
}
