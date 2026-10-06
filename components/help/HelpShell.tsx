import type { ReactNode } from 'react';
import { COMPANY } from '@/lib/legal';

// The frame for the public help centre (/help): wordmark, a way back, the footer.
export default function HelpShell({ children, crumb }: { children: ReactNode; crumb?: ReactNode }) {
  return (
    <main className="legal hc">
      <div className="hc-top">
        <a className="wordmark legal-mark" href="/">Mise<i aria-hidden /></a>
        <nav className="hc-crumb"><a href="/help">Help centre</a>{crumb ? <> › {crumb}</> : null}</nav>
        <span className="spacer" />
        <a className="btn hc-open" href="/">Open Mise</a>
      </div>
      {children}
      <footer className="legal-foot">
        {COMPANY.name}, trading as {COMPANY.trading} · <a href="/help">Help</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a>
      </footer>
    </main>
  );
}
