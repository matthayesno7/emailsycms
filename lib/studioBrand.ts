'use client';
// What the Studio needs to draw a design in the brand: colours by role, fonts, button style
// and logos, plus how to find each library image. Shared by Create (new designs) and the asset
// page (editing a saved design), so both draw exactly the same thing.
import { normaliseKit, type BrandKitRow } from './brandKit';
import type { StudioBrand } from '@/components/DesignCanvas';

type A = { id: string; kind: string; storage_path?: string | null; images?: any };

export function studioKit(wsName: string, kitRow: BrandKitRow | null, items: A[], urls: Record<string, string>) {
  const k = normaliseKit(kitRow?.kit || { name: wsName }, wsName);
  const src = (a?: A) => (a ? (a.images?.email?.path && urls[a.images.email.path]) || (a.storage_path ? urls[a.storage_path] : undefined) : undefined);
  const logoAsset = items.find((i) => i.id === k.logos.primary) || items.find((i) => i.kind === 'logo');
  const reversed = items.find((i) => i.id === k.logos.reversed);
  const stack = (f: { family: string; fallback: string }) => [f.family && `'${f.family}'`, f.fallback].filter(Boolean).join(', ');
  const primary = k.colors.primary || '#1d1d1f';
  const accent = k.colors.accent || k.colors.secondary || k.colors.primary || '#e8a317';
  const text = k.colors.text || '#1d1d1f';
  const brand: StudioBrand = {
    colors: {
      primary, secondary: k.colors.secondary || accent, accent, text, text_muted: k.colors.text_muted || text,
      background: k.colors.background || '#ffffff', surface: k.colors.surface || '#f1efeb',
      button_bg: k.colors.button_bg || primary, button_text: k.colors.button_text || '#ffffff', white: '#ffffff', black: '#111111',
    },
    head: stack(k.type.heading) || 'Georgia, serif', body: stack(k.type.body) || 'Arial, sans-serif', upper: k.type.heading_case === 'upper',
    button: { style: k.button.style, radius: k.button.radius, weight: k.button.weight, upper: k.button.case === 'upper' },
    logo: src(logoAsset), logoReversed: reversed?.storage_path ? urls[reversed.storage_path] : undefined, name: wsName,
  };
  const fonts = [...new Set([k.type.heading.url, k.type.body.url].filter(Boolean))];
  // Full-size originals for images placed in designs.
  const srcOf = (id: string) => { const a = items.find((i) => i.id === id); return a?.storage_path ? urls[a.storage_path] : undefined; };
  return { kit: k, brand, fonts, srcOf };
}
