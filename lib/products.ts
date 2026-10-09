// Products are cards that build themselves from the feed: image, label, name,
// description, price and button. Copy the team edits is kept when the feed syncs again.

export const DEFAULT_CTA = 'Shop now';

// Plain text from a feed description (which may hold HTML), shortened for an email card.
export function cleanText(s: string) {
  return (s || '')
    .replace(/<br\s*\/?>|<\/p>|<\/li>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, '’').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function shortDescription(s: string, max = 140) {
  const t = cleanText(s);
  if (t.length <= max) return t;
  // Whole sentences if they fit, otherwise cut at a word.
  const sentences = t.match(/[^.!?]+[.!?]+/g) || [];
  let out = '';
  for (const x of sentences) { if ((out + x).trim().length > max) break; out += x; }
  if (out.trim().length >= 40) return out.trim();
  return t.slice(0, max - 1).replace(/\s+\S*$/, '') + '…';
}

// A product row seen as a Product block (for previews and for Figma).
export function productAsBlock(p: { name: string; price?: string | null; link?: string | null; storage_path?: string | null; width?: number | null; height?: number | null; fields?: any }) {
  const f = p.fields || {};
  return {
    block_type: 'product',
    fields: {
      eyebrow: f.eyebrow || '',
      name: p.name || '',
      body: f.description || '',
      price: p.price || '',
      cta: f.cta ?? DEFAULT_CTA,
      link: p.link || '',
    },
    images: p.storage_path ? { image: { path: p.storage_path, width: p.width || null, height: p.height || null } } : {},
  };
}

export type ProductCopy = { name: string; eyebrow: string; description: string; price: string; cta: string; link: string };
export const productCopy = (p: { name: string; price?: string | null; link?: string | null; fields?: any }): ProductCopy => {
  const f = p.fields || {};
  return { name: p.name || '', eyebrow: f.eyebrow || '', description: f.description || '', price: p.price || '', cta: f.cta ?? DEFAULT_CTA, link: p.link || '' };
};
// The update for a product's card copy. Name, label, description and button the team edits are
// marked, so a feed sync keeps them; price, link and photo always follow the feed.
export function productPatch(p: { name: string; fields?: any }, v: ProductCopy) {
  const f0 = p.fields || {};
  const edited = new Set<string>(f0.edited || []);
  for (const [k, was] of [['name', p.name], ['eyebrow', f0.eyebrow], ['description', f0.description], ['cta', f0.cta ?? DEFAULT_CTA]] as const) if ((v as any)[k] !== (was || '')) edited.add(k);
  return {
    name: v.name.trim().slice(0, 120), price: v.price.trim() || null, link: v.link.trim() || null,
    fields: { ...f0, eyebrow: v.eyebrow.trim(), description: v.description.trim(), cta: v.cta.trim(), edited: [...edited] },
  };
}
