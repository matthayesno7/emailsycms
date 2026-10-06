import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import HelpShell from '@/components/help/HelpShell';
import HelpToc from '@/components/help/HelpToc';
import { HELP_ARTICLES, HELP_ORIGIN, helpArticle } from '@/lib/helpArticles';
import { headings, navLabel } from '@/lib/helpNav';
import { markdown } from '@/lib/markdown';

export const dynamicParams = false;
export function generateStaticParams() {
  return HELP_ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const a = helpArticle((await params).slug);
  if (!a) return {};
  return { title: `${a.title} · Mise help`, description: a.description, alternates: { canonical: `${HELP_ORIGIN}/help/${a.slug}` } };
}

export default async function Article({ params }: { params: Promise<{ slug: string }> }) {
  const a = helpArticle((await params).slug);
  if (!a) notFound();
  const i = HELP_ARTICLES.findIndex((x) => x.slug === a.slug);
  const prev = HELP_ARTICLES[i - 1];
  const next = HELP_ARTICLES[i + 1];
  const toc = headings(a.body);
  return (
    <HelpShell active={a.slug} aside={<HelpToc items={toc} />}>
      <article className="hc-article">
        <p className="hcx-eyebrow">{a.category}</p>
        <h1>{a.title}</h1>
        <p className="hcx-lede">{a.description}</p>
        <div className="hc-body" dangerouslySetInnerHTML={{ __html: markdown(a.body) }} />
      </article>
      <p className="hcx-ask">Didn’t answer your question? In Mise, click <b>Help</b> at the bottom of the sidebar and ask in your own words.</p>
      <nav className="hcx-pager" aria-label="More articles">
        {prev ? <a href={`/help/${prev.slug}`}><small>← Previous</small><b>{navLabel(prev)}</b></a> : <span />}
        {next ? <a className="next" href={`/help/${next.slug}`}><small>Next →</small><b>{navLabel(next)}</b></a> : <span />}
      </nav>
    </HelpShell>
  );
}
