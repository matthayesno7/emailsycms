import { COMPANY, type Section } from '@/lib/legal';

// Terms, Privacy, Security and the DPA: one simple, readable page each, public (no sign-in).
export default function LegalPage({ title, intro, sections }: { title: string; intro?: string; sections: Section[] }) {
  return (
    <main className="legal">
      <a className="wordmark legal-mark" href="/">Mise<i aria-hidden /></a>
      <h1>{title}</h1>
      <p className="legal-meta">Last updated {COMPANY.updated}{intro ? ` · ${intro}` : ''}</p>
      {sections.map((s) => (
        <section key={s.h}>
          <h2>{s.h}</h2>
          {groups(s.p).map((g, i) => g.list
            ? <ul key={i}>{g.items.map((t) => <li key={t}>{t.slice(2)}</li>)}</ul>
            : <p key={i}>{g.items[0]}</p>)}
        </section>
      ))}
      <footer className="legal-foot">
        {COMPANY.name}, trading as {COMPANY.trading} · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a> · <a href="/security">Security</a> · <a href="/dpa">DPA</a> · <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a>
      </footer>
    </main>
  );
}

// Consecutive "- " paragraphs become one list.
function groups(ps: string[]) {
  const out: { list: boolean; items: string[] }[] = [];
  for (const p of ps) {
    const list = p.startsWith('- ');
    const last = out[out.length - 1];
    if (list && last?.list) last.items.push(p); else out.push({ list, items: [p] });
  }
  return out;
}
