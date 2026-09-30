'use client';
import type { Layer, Role, Spec } from '@/lib/design';

// Draws a Studio design spec with the brand's colours, fonts, button and logo.
// On screen it scales with its box (cqw units); for export it renders at exact pixels.

export type StudioBrand = {
  colors: Record<Role, string>;
  head: string; body: string; upper: boolean;
  button: { style: 'filled' | 'outline' | 'underline'; radius: number; weight: number; upper: boolean };
  logo?: string; logoReversed?: string; name: string;
};

export default function DesignCanvas({ spec, size, brand, srcOf, px, editable, onText }: {
  spec: Spec;
  size: { w: number; h: number };
  brand: StudioBrand;
  srcOf: (assetId: string) => string | undefined;
  px?: number; // render at this exact width in pixels (export)
  editable?: boolean;
  onText?: (index: number, text: string) => void;
}) {
  const u = (v: number) => (px ? `${(v * px) / 100}px` : `${v}cqw`);
  const c = (r: Role) => brand.colors[r] || '#000';
  const box: React.CSSProperties = px
    ? { width: px, height: Math.round((px * size.h) / size.w) }
    : { width: '100%', aspectRatio: `${size.w} / ${size.h}`, containerType: 'inline-size' as any };
  const anchor = (x: number, align: string): React.CSSProperties =>
    align === 'center' ? { left: `${x}%`, transform: 'translateX(-50%)' } : align === 'right' ? { left: `${x}%`, transform: 'translateX(-100%)' } : { left: `${x}%` };

  const layer = (l: Layer, i: number) => {
    switch (l.type) {
      case 'image': {
        const s = srcOf(l.asset);
        return (
          <div key={i} style={{ position: 'absolute', left: `${l.x}%`, top: `${l.y}%`, width: `${l.w}%`, height: `${l.h}%`, borderRadius: u(l.radius / 4), overflow: 'hidden', backgroundColor: l.fit === 'contain' ? 'transparent' : c('surface'),
            backgroundImage: s ? `url("${s}")` : undefined, backgroundSize: l.fit, backgroundRepeat: 'no-repeat', backgroundPosition: l.focus ? `${l.focus.x * 100}% ${l.focus.y * 100}%` : 'center' }}>
            {l.shade > 0 && <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(to top, rgba(0,0,0,${l.shade}), rgba(0,0,0,${l.shade * 0.35}) 55%, rgba(0,0,0,0))` }} />}
          </div>
        );
      }
      case 'rect':
        return <div key={i} style={{ position: 'absolute', left: `${l.x}%`, top: `${l.y}%`, width: `${l.w}%`, height: `${l.h}%`, background: c(l.fill), opacity: l.opacity, borderRadius: u(l.radius / 4) }} />;
      case 'text': {
        const head = l.role === 'headline' || l.role === 'subhead';
        return (
          <div key={i} data-layer={i}
            contentEditable={editable || undefined} suppressContentEditableWarning spellCheck={false}
            onBlur={editable ? (e) => onText?.(i, (e.currentTarget.textContent || '').trim()) : undefined}
            onKeyDown={editable ? (e) => { if (e.key === 'Enter') { e.preventDefault(); (e.currentTarget as HTMLElement).blur(); } } : undefined}
            className={editable ? 'dc-edit' : undefined}
            style={{ position: 'absolute', left: `${l.x}%`, top: `${l.y}%`, width: `${l.w}%`, fontSize: u(l.size), color: c(l.color), textAlign: l.align,
              fontFamily: head ? brand.head : brand.body, fontWeight: l.weight, lineHeight: l.role === 'headline' ? 1.04 : l.role === 'body' ? 1.4 : 1.15,
              letterSpacing: l.role === 'eyebrow' ? '0.12em' : l.role === 'headline' ? '-0.01em' : undefined,
              textTransform: l.upper || (l.role === 'headline' && brand.upper) || l.role === 'eyebrow' ? 'uppercase' : 'none', whiteSpace: 'pre-wrap', overflowWrap: 'break-word' }}>
            {l.text}
          </div>
        );
      }
      case 'button': {
        const b = brand.button;
        const filled = b.style === 'filled', under = b.style === 'underline';
        // "light" buttons sit on dark photos or panels: white, with the button colour as text.
        const fg = l.tone === 'light' ? (filled ? c('button_bg') : '#ffffff') : filled ? c('button_text') : c('button_bg');
        const bgc = l.tone === 'light' ? '#ffffff' : c('button_bg');
        const line = l.tone === 'light' ? '#ffffff' : c('button_bg');
        return (
          <div key={i} style={{ position: 'absolute', top: `${l.y}%`, ...anchor(l.x, l.align), fontSize: u(l.size), fontFamily: brand.body, fontWeight: b.weight, whiteSpace: 'nowrap', lineHeight: 1,
            textTransform: b.upper ? 'uppercase' : 'none', letterSpacing: b.upper ? '0.06em' : undefined,
            ...(under
              ? { color: line, borderBottom: `${u(l.size / 8)} solid ${line}`, paddingBottom: u(l.size / 4) }
              : { background: filled ? bgc : 'transparent', color: fg, border: filled ? 0 : `${u(l.size / 9)} solid ${line}`,
                  padding: `${u(l.size * 0.85)} ${u(l.size * 1.6)}`, borderRadius: b.radius >= 99 ? 999 : u((b.radius / 16) * l.size) }) }}>
            {l.text}
          </div>
        );
      }
      case 'logo': {
        const s = l.variant === 'reversed' ? brand.logoReversed || brand.logo : brand.logo;
        const invert = l.variant === 'reversed' && !brand.logoReversed;
        return s
          ? <img key={i} src={s} alt="" style={{ position: 'absolute', top: `${l.y}%`, ...anchor(l.x, l.align), height: `${l.h}%`, width: 'auto', maxWidth: '45%', objectFit: 'contain', filter: invert ? 'brightness(0) invert(1)' : undefined }} />
          : <div key={i} style={{ position: 'absolute', top: `${l.y}%`, ...anchor(l.x, l.align), fontFamily: brand.head, fontWeight: 700, whiteSpace: 'nowrap', color: l.variant === 'reversed' ? '#fff' : c('text'),
              fontSize: px ? `${(l.h / 100) * (px * size.h / size.w) * 0.7}px` : `${(l.h * size.h / size.w) * 0.7}cqw`, lineHeight: 1 }}>{brand.name}</div>;
      }
    }
  };

  return (
    <div className="dc" style={{ position: 'relative', overflow: 'hidden', background: c(spec.background), fontFamily: brand.body, ...box }}>
      {spec.layers.map(layer)}
    </div>
  );
}
