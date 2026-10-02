// The shell of every public page (share links and portals), dressed in the brand kit.
import type { BrandKit } from '@/lib/brandKit';
import { brandVars, fontAssets } from './brandStyle';

export default function PublicFrame({ kit, brandName, logoUrl, nav, children, preview }: {
  kit: BrandKit | null;
  brandName: string;
  logoUrl?: string | null;
  nav?: { href: string; label: string; on?: boolean }[];
  children: React.ReactNode;
  preview?: string | null; // shown to the brand's own team, e.g. "Preview: this portal is unpublished"
}) {
  const fonts = fontAssets(kit);
  return (
    <div className="pub">
      {fonts.links.map((l) => <link key={l} rel="stylesheet" href={l} />)}
      <style dangerouslySetInnerHTML={{ __html: `.pub{${brandVars(kit)}}${fonts.css}` }} />
      {preview && <div className="pub-preview">{preview}</div>}
      <header className="pub-head">
        <div className="pub-brand">
          {logoUrl ? <img src={logoUrl} alt={brandName} /> : <span className="pub-name">{brandName}</span>}
        </div>
        {nav && nav.length > 1 && (
          <nav className="pub-nav">
            {nav.map((n) => <a key={n.href} href={n.href} aria-current={n.on ? 'page' : undefined}>{n.label}</a>)}
          </nav>
        )}
      </header>
      <main className="pub-main">{children}</main>
      <footer className="pub-foot">Shared with Mise</footer>
    </div>
  );
}
