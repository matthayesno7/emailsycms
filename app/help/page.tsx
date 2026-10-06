import type { Metadata } from 'next';
import HelpShell from '@/components/help/HelpShell';
import HelpIndex from '@/components/help/HelpIndex';
import { HELP_INTRO } from '@/lib/helpArticles';

export const metadata: Metadata = {
  title: 'Help centre · Mise',
  description: 'How to set up and use Mise, the brand asset library for the AI era: files, products, Create, sharing, Claude, plans and billing.',
  alternates: { canonical: 'https://misedam.com/help' },
};

export default function Help() {
  return (
    <HelpShell>
      <h1>How can we help?</h1>
      <p className="legal-meta">{HELP_INTRO}</p>
      <HelpIndex />
    </HelpShell>
  );
}
