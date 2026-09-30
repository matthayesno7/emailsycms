// Library tabs: images are grouped by what they're for, worked out from their size
// (Studio designs also record their canvas). Everything else groups by kind.

export type Tab = { id: string; label: string; sizes?: [number, number][] };

export const IMAGE_TABS: Tab[] = [
  { id: 'email-banner', label: 'Email banners', sizes: [[1200, 600], [600, 300], [1200, 300], [600, 150], [1200, 400], [640, 800], [1280, 640]] },
  { id: 'linkedin-banner', label: 'LinkedIn banners', sizes: [[1128, 191], [1584, 396], [1536, 768]] },
  { id: 'linkedin-post', label: 'LinkedIn posts & ads', sizes: [[1200, 627], [1200, 628], [1200, 630], [1200, 1200]] },
  { id: 'social-post', label: 'Social posts', sizes: [[1080, 1350], [1080, 1080], [1080, 1440], [1600, 900]] },
  { id: 'story', label: 'Stories', sizes: [[1080, 1920], [720, 1280]] },
  { id: 'thumb', label: 'Thumbnails & slides', sizes: [[1280, 720], [1920, 1080]] },
  { id: 'display', label: 'Display ads', sizes: [[300, 250], [728, 90], [160, 600], [300, 600], [320, 50], [970, 250]] },
];

export const TABS: Tab[] = [
  { id: 'all', label: 'All' },
  { id: 'photo', label: 'Photos' },
  ...IMAGE_TABS,
  { id: 'video', label: 'Videos' },
  { id: 'logo', label: 'Logos' },
  { id: 'product', label: 'Products' },
  { id: 'block', label: 'Email blocks' },
];

const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(2, b * 0.01);

// Which tab an asset belongs in.
export function tabOf(a: { kind: string; width?: number | null; height?: number | null; provenance?: any }): string {
  if (a.kind !== 'image') return a.kind;
  const w = a.provenance?.size?.w || a.width, h = a.provenance?.size?.h || a.height;
  if (!w || !h) return 'photo';
  for (const t of IMAGE_TABS) {
    // Match the exact size, or the same design at half or double scale.
    if (t.sizes!.some(([tw, th]) => [1, 0.5, 2].some((k) => near(w, tw * k) && near(h, th * k)))) return t.id;
  }
  return 'photo';
}

export const tabLabel = (id: string) => TABS.find((t) => t.id === id)?.label || 'All';
