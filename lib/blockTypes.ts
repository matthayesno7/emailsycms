// Blocks are generic email content shapes. They are not tied to any design system:
// Claude turns a block into a component inside whichever Figma design system the user picks.

export type BlockField = {
  k: string;
  type: 'image' | 'text' | 'long' | 'url' | 'choice';
  label: string;
  max?: number;
  w?: number; // image slot size in CSS px (exported at 2x)
  h?: number;
  fit?: 'cover' | 'contain';
  png?: boolean;
  side?: { w: number; h: number }; // slot size when the image sits beside the copy (layout left/right)
  options?: [string, string][]; // for choice fields: [value, label]
  natural?: boolean; // keep the source's aspect ratio: w is the width, height follows the image
  linkOf?: string;
};

export type BlockType = { name: string; note: string; fields: BlockField[] };

export const BLOCK_TYPES: Record<string, BlockType> = {
  hero: {
    name: 'Hero',
    note: 'Big image, headline, subhead, paragraph and one button.',
    fields: [
      { k: 'image', type: 'image', label: 'Hero image', w: 600, h: 400, fit: 'cover' },
      { k: 'headline', type: 'text', label: 'Headline', max: 60 },
      { k: 'subhead', type: 'text', label: 'Subhead', max: 90 },
      { k: 'body', type: 'long', label: 'Paragraph', max: 300 },
      { k: 'cta', type: 'text', label: 'Button label', max: 25 },
      { k: 'link', type: 'url', label: 'Button link', linkOf: 'cta' },
    ],
  },
  card: {
    name: 'Card',
    note: 'Image with a sub header, title, optional stars, text, name and a button. Image on top, left or right.',
    fields: [
      { k: 'image', type: 'image', label: 'Image', w: 300, h: 200, fit: 'cover', side: { w: 240, h: 320 } },
      { k: 'layout', type: 'choice', label: 'Layout', options: [['top', 'Image on top'], ['left', 'Image left'], ['right', 'Image right']] },
      { k: 'eyebrow', type: 'text', label: 'Sub header', max: 30 },
      { k: 'headline', type: 'text', label: 'Title', max: 50 },
      { k: 'rating', type: 'choice', label: 'Star rating', options: [['', 'None'], ['5', '5 stars'], ['4', '4 stars'], ['3', '3 stars'], ['2', '2 stars'], ['1', '1 star']] },
      { k: 'body', type: 'long', label: 'Text', max: 220 },
      { k: 'name', type: 'text', label: 'Name', max: 40 },
      { k: 'cta', type: 'text', label: 'Button label', max: 24 },
      { k: 'link', type: 'url', label: 'Link', linkOf: 'cta' },
    ],
  },
  product: {
    name: 'Product',
    note: 'One product from your feed: image, label, name, description, price and button.',
    fields: [
      { k: 'image', type: 'image', label: 'Product image', w: 300, h: 300, fit: 'contain' },
      { k: 'eyebrow', type: 'text', label: 'Label', max: 30 },
      { k: 'name', type: 'text', label: 'Product name', max: 60 },
      { k: 'body', type: 'long', label: 'Description', max: 160 },
      { k: 'price', type: 'text', label: 'Price', max: 16 },
      { k: 'cta', type: 'text', label: 'Button label', max: 20 },
      { k: 'link', type: 'url', label: 'Product link', linkOf: 'cta' },
    ],
  },
  button: {
    name: 'Button',
    note: 'A single call-to-action button.',
    fields: [
      { k: 'cta', type: 'text', label: 'Button label', max: 25 },
      { k: 'link', type: 'url', label: 'Button link', linkOf: 'cta' },
    ],
  },
  footer: {
    name: 'Footer',
    note: 'Logo, legal text, postal address and unsubscribe line.',
    fields: [
      { k: 'logo', type: 'image', label: 'Logo', w: 150, h: 50, fit: 'contain', png: true },
      { k: 'legal', type: 'long', label: 'Legal text', max: 300 },
      { k: 'address', type: 'text', label: 'Postal address', max: 120 },
      { k: 'unsub', type: 'text', label: 'Unsubscribe line', max: 40 },
    ],
  },
  design: {
    name: 'Design',
    note: 'A finished design (photo and copy in one image). Emailsy reads it: the photo stays an image and the copy becomes editable, keeping the design’s own look.',
    fields: [
      { k: 'image', type: 'image', label: 'Photo', w: 600, fit: 'cover', natural: true },
      { k: 'layout', type: 'choice', label: 'Layout', options: [['top', 'Photo on top'], ['left', 'Photo left'], ['right', 'Photo right']] },
      { k: 'eyebrow', type: 'text', label: 'Sub header', max: 40 },
      { k: 'headline', type: 'text', label: 'Headline', max: 80 },
      { k: 'rating', type: 'choice', label: 'Star rating', options: [['', 'None'], ['5', '5 stars'], ['4', '4 stars'], ['3', '3 stars'], ['2', '2 stars'], ['1', '1 star']] },
      { k: 'body', type: 'long', label: 'Text', max: 300 },
      { k: 'name', type: 'text', label: 'Name', max: 40 },
      { k: 'cta', type: 'text', label: 'Button label', max: 30 },
      { k: 'link', type: 'url', label: 'Link', linkOf: 'cta' },
      { k: 'notes', type: 'long', label: 'Notes for Claude', max: 300 },
    ],
  },
};

// Pixel size an image slot is exported at (2x for retina). Natural slots keep the
// source's shape and never upscale.
// A Design block whose copy has been read out of the image (so it is editable).
export const isReadDesign = (b: any) => b?.block_type === 'design' && !!b?.images?.reference?.path;

export function exportSize(d: BlockField, sw?: number, sh?: number, layout?: string) {
  if (d.side && (layout === 'left' || layout === 'right')) return { w: d.side.w * 2, h: d.side.h * 2 };
  if (d.natural) {
    if (!sw || !sh) return { w: (d.w || 600) * 2, h: 0 };
    const w = Math.round(Math.min((d.w || 600) * 2, sw));
    return { w, h: Math.round((w * sh) / sw) };
  }
  return { w: (d.w || 300) * 2, h: (d.h || 200) * 2 };
}

// Email-ready export sizes for single images (pixels, already 2x for retina).
export const PRESETS = [
  { id: 'orig', name: 'Original' },
  { id: 'full', name: 'Full width', w: 1200, h: 600 },
  { id: 'half', name: 'Two column', w: 560, h: 560 },
  { id: 'mob', name: 'Mobile hero', w: 640, h: 800 },
  { id: 'sq', name: 'Square', w: 1200, h: 1200 },
] as { id: string; name: string; w?: number; h?: number }[];

export const KIND_LABEL: Record<string, string> = {
  all: 'All assets',
  image: 'Images',
  logo: 'Logos',
  product: 'Products',
  block: 'Blocks',
};
