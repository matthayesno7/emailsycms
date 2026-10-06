import type { ReactNode } from 'react';
import { COMPANY } from '@/lib/legal';
import { HELP_NAV } from '@/lib/helpNav';
import HelpSearch from '@/components/help/HelpSearch';

const BOOK = 'https://calendar.notion.so/meet/matthayes/3363f4yal';

// The frame for the public help centre (/help), laid out like a docs site:
// a top bar with search, every article in a sidebar, the page in the middle.
export default function HelpShell({ children, active, aside }: { children: ReactNode; active?: string; aside?: ReactNode }) {
  return (
    <div className="hcx">
      <input type="checkbox" id="hcx-nav" className="hcx-navtoggle" aria-hidden tabIndex={-1} />
      <header className="hcx-top">
        <div className="hcx-top-in">
          <label htmlFor="hcx-nav" className="hcx-burger" aria-label="Show sections"><span /><span /><span /></label>
          <a className="hcx-brand" href="/help" aria-label="Mise help centre">
            <span className="wordmark">Mise<i aria-hidden /></span><span className="hcx-brand-tag">Help</span>
          </a>
          <HelpSearch />
          <nav className="hcx-links">
            <a className="hcx-link" href={BOOK} target="_blank" rel="noreferrer">Book a call</a>
            <a className="primary hcx-open" href="/">Open Mise</a>
          </nav>
        </div>
      </header>
      <div className={`hcx-body${aside ? ' has-aside' : ''}`}>
        <aside className="hcx-side" aria-label="Help sections">
          <nav>
            <a className={`hcx-home${!active ? ' on' : ''}`} href="/help" aria-current={!active ? 'page' : undefined}>Home</a>
            {HELP_NAV.map((g) => (
              <div key={g.category} className="hcx-group">
                <h2>{g.category}</h2>
                <ul>
                  {g.items.map((it) => (
                    <li key={it.slug}>
                      <a href={`/help/${it.slug}`} className={active === it.slug ? 'on' : undefined} aria-current={active === it.slug ? 'page' : undefined}>{it.label}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </aside>
        <label htmlFor="hcx-nav" className="hcx-scrim" aria-hidden />
        <div className="hcx-main">
          {children}
          <footer className="hcx-foot">
            <span>{COMPANY.name}, trading as {COMPANY.trading}</span>
            <span><a href="https://misedam.com">misedam.com</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="/security">Security</a></span>
          </footer>
        </div>
        {aside ? <aside className="hcx-aside">{aside}</aside> : null}
      </div>
    </div>
  );
}
