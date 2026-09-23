// Small inline icons and the block wireframes.
type P = { size?: number };
const S = ({ size = 18, children }: P & { children: React.ReactNode }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);

export const Icon = {
  Mark: () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m4 7 8 6 8-6" />
    </svg>
  ),
  Home: (p: P) => <S {...p}><path d="M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" /></S>,
  Search: (p: P) => <S {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></S>,
  Image: (p: P) => <S {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="m21 16-5-5-9 9" /></S>,
  Shield: (p: P) => <S {...p}><path d="M12 3 4 7v5c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V7z" /></S>,
  Tag: (p: P) => <S {...p}><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" /><circle cx="7.5" cy="7.5" r="1.5" /></S>,
  Blocks: (p: P) => <S {...p}><rect x="3" y="3" width="18" height="8" rx="1.5" /><rect x="3" y="14" width="8" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></S>,
  Plus: (p: P) => <S {...p}><path d="M12 5v14M5 12h14" /></S>,
  Users: (p: P) => <S {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.5 3.3-5.5 6.5-5.5s5.7 2 6.5 5.5" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.8.7 3 2.5 3.5 5.2" /></S>,
  Plug: (p: P) => <S {...p}><path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4" /></S>,
  Send: (p: P) => <S {...p}><path d="M22 2 11 13" /><path d="M22 2 15 22l-4-9-9-4z" /></S>,
  Table: (p: P) => <S {...p}><path d="M4 4h16v16H4z" /><path d="M4 9h16M9 9v11" /></S>,
  Menu: (p: P) => <S size={20} {...p}><path d="M4 7h16M4 12h16M4 17h16" /></S>,
  Chevron: (p: P) => <S size={12} {...p}><path d="m9 6 6 6-6 6" /></S>,
  Download: (p: P) => <S {...p}><path d="M12 3v12M7 10l5 5 5-5" /><path d="M4 17v3h16v-3" /></S>,
  Close: (p: P) => <S size={16} {...p}><path d="M6 6l12 12M18 6 6 18" /></S>,
};

const WIRE: Record<string, string> = {
  hero: '<rect x="4" y="4" width="92" height="44" rx="2" class="wi"/><rect x="22" y="54" width="56" height="6" rx="1"/><rect x="30" y="64" width="40" height="4" rx="1" class="wl"/><rect x="18" y="72" width="64" height="3" rx="1" class="wl"/><rect x="24" y="78" width="52" height="3" rx="1" class="wl"/><rect x="36" y="86" width="28" height="8" rx="2" class="wb"/>',
  card: '<rect x="20" y="8" width="60" height="40" rx="2" class="wi"/><rect x="20" y="54" width="44" height="6" rx="1"/><rect x="20" y="64" width="60" height="3" rx="1" class="wl"/><rect x="20" y="70" width="50" height="3" rx="1" class="wl"/><rect x="20" y="80" width="26" height="8" rx="2" class="wb"/>',
  product: '<rect x="14" y="6" width="72" height="44" rx="2" class="wi"/><rect x="38" y="56" width="24" height="3" rx="1" class="wl"/><rect x="26" y="63" width="48" height="6" rx="1"/><rect x="40" y="73" width="20" height="4" rx="1" class="wl"/><rect x="38" y="83" width="24" height="8" rx="2" class="wb"/>',
  button: '<rect x="30" y="42" width="40" height="14" rx="3" class="wb"/>',
  footer: '<rect x="38" y="16" width="24" height="9" rx="1"/><circle cx="36" cy="36" r="3" class="wl"/><circle cx="46" cy="36" r="3" class="wl"/><circle cx="56" cy="36" r="3" class="wl"/><circle cx="66" cy="36" r="3" class="wl"/><rect x="14" y="48" width="72" height="3" rx="1" class="wl"/><rect x="20" y="54" width="60" height="3" rx="1" class="wl"/><rect x="28" y="64" width="44" height="3" rx="1" class="wl"/><rect x="40" y="74" width="20" height="3" rx="1"/>',
};

export function Wire({ type }: { type: string }) {
  return <svg className="wire" viewBox="0 0 100 100" aria-hidden="true" dangerouslySetInnerHTML={{ __html: WIRE[type] || '' }} />;
}

export const ART = `<svg class="art" viewBox="0 0 330 240" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M40 196c40-2 210-1 250 1"/><path d="M92 196V112c0-4 2-7 6-9l62-34c4-2 8-2 12 0l62 34c4 2 6 5 6 9v84"/>
  <path d="M94 110l70 48c4 2 7 2 10 0l66-47"/><path d="M116 88V52c0-3 2-5 5-5h90c3 0 5 2 5 5v36"/><path d="M128 60h40M128 70h26"/>
  <rect x="178" y="56" width="26" height="22" rx="3"/><path d="m180 76 8-8 6 6 4-4 6 6"/><path d="M232 60l22-14 14 20-22 14z"/><circle cx="248" cy="58" r="2.5"/>
  <path d="M60 70l4 9 9 1-7 6 2 9-8-5-8 5 2-9-7-6 9-1z"/><path d="M270 120c6 2 9 7 7 13M280 108c9 4 14 13 11 23"/>
  <path d="M50 140h16M50 148h10"/><path d="M296 160l10 10M306 160l-10 10"/>
  <circle cx="164" cy="140" r="15" stroke="#2f5bff"/><path d="M164 133v14M157 140h14" stroke="#2f5bff"/>
</svg>`;
