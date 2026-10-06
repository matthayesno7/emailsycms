'use client';
import { useMemo, useState } from 'react';
import { HELP_ARTICLES, HELP_CATEGORIES } from '@/lib/helpArticles';

// The help centre's front page: search across every article, then the articles by section.
export default function HelpIndex() {
  const [q, setQ] = useState('');
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = useMemo(() => {
    if (!words.length) return [];
    return HELP_ARTICLES.map((a) => {
      const hay = `${a.title} ${a.description} ${a.body}`.toLowerCase();
      const title = `${a.title} ${a.description}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return null;
      const score = words.reduce((s, w) => s + (title.includes(w) ? 5 : 0) + hay.split(w).length - 1, 0);
      return { a, score };
    }).filter(Boolean).sort((x, y) => y!.score - x!.score).slice(0, 12).map((x) => x!.a);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <input className="in hc-search" type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)}
        placeholder="Search the help centre, e.g. “connect Shopify” or “share a folder”" aria-label="Search the help centre" />
      {words.length > 0 ? (
        <section className="hc-results">
          {hits.length ? hits.map((a) => (
            <a key={a.slug} className="hc-card" href={`/help/${a.slug}`}><b>{a.title}</b><span>{a.description}</span></a>
          )) : <p className="tip">Nothing matches “{q}”. Try other words, or open Mise and ask under Help.</p>}
        </section>
      ) : HELP_CATEGORIES.map((c) => (
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
