// Blocks are generic email content shapes. They are not tied to any design system:
// Claude turns a block into a component inside whichever Figma design system the user picks.

export type BlockField = {
  k: string;
  type: 'image' | 'text' | 'long' | 'url';
  label: string;
  max?: number;
  w?: number; // image slot size in CSS px (exported at 2x)
  h?: number;
  fit?: 'cover' | 'contain';
  png?: boolean;
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
    note: 'Image with a title, short text and a button. Use it in rows of one, two or three.',
    fields: [
      { k: 'image', type: 'image', label: 'Image', w: 300, h: 200, fit: 'cover' },
      { k: 'headline', type: 'text', label: 'Title', max: 50 },
      { k: 'body', type: 'long', label: 'Text', max: 160 },
      { k: 'cta', type: 'text', label: 'Button label', max: 20 },
      { k: 'link', type: 'url', label: 'Link', linkOf: 'cta' },
    ],
  },
  product: {
    name: 'Product',
    note: 'One product from your feed: image, label, name, price and button.',
    fields: [
      { k: 'image', type: 'image', label: 'Product image', w: 300, h: 300, fit: 'contain' },
      { k: 'eyebrow', type: 'text', label: 'Label', max: 30 },
      { k: 'name', type: 'text', label: 'Product name', max: 60 },
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
};

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
