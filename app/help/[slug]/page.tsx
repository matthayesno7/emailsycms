import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import HelpShell from '@/components/help/HelpShell';
import { HELP_ARTICLES, HELP_ORIGIN, helpArticle } from '@/lib/helpArticles';
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
  const related = HELP_ARTICLES.filter((x) => x.category === a.category && x.slug !== a.slug);
  const i = HELP_ARTICLES.findIndex((x) => x.slug === a.slug);
  const next = HELP_ARTICLES[i + 1];
  return (
    <HelpShell crumb={a.category}>
      <article className="hc-article">
        <h1>{a.title}</h1>
        <p className="legal-meta">{a.description}</p>
        <div className="hc-body" dangerouslySetInnerHTML={{ __html: markdown(a.body) }} />
      </article>
      <aside className="hc-after">
        {next && <a className="hc-card hc-next" href={`/help/${next.slug}`}><span>Next</span><b>{next.title}</b></a>}
        {related.length > 0 && (
          <div>
            <h2>More in {a.category}</h2>
            <ul>{related.map((r) => <li key={r.slug}><a href={`/help/${r.slug}`}>{r.title}</a></li>)}</ul>
          </div>
        )}
        <p className="tip">Didn’t answer your question? In Mise, click <b>Help</b> at the bottom of the sidebar and ask in your own words.</p>
      </aside>
    </HelpShell>
  );
}
