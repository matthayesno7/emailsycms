'use client';
import { HELP_ARTICLES, HELP_CATEGORIES } from '@/lib/helpArticles';

// The help centre's front page: a search box that opens search, then every article by section.
export default function HelpIndex() {
  return (
    <>
      <button type="button" className="hcx-bigsearch" onClick={() => window.dispatchEvent(new Event('hcx-search'))}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        Search the help centre, e.g. “connect Shopify” or “share a folder”
      </button>
      <div className="hcx-start">
        <a className="hc-card hcx-feature" href="/help/quick-start"><small>Start here</small><b>Set up Mise in 10 minutes</b><span>From sign-in to a tidy library, a brand kit, a first design and a link to share.</span></a>
        <a className="hc-card hcx-feature" href="/help/claude-connector"><small>Claude</small><b>Connect Claude</b><span>Use your library, brand kit and products inside Claude, Claude Code and Figma.</span></a>
      </div>
      {HELP_CATEGORIES.map((c) => (
        <section key={c} className="hc-sec">
          <h2>{c}</h2>
          <div className="hc-grid">
            {HELP_ARTICLES.filter((a) => a.category === c).map((a) => (
              <a key={a.slug} className="hc-card" href={`/help/${a.slug}`}><b>{a.title}</b><span>{a.description}</span></a>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
