'use client';
import { useRef, useState } from 'react';
import { markdown } from '@/lib/markdown';

const STARTERS = ['How do I connect Shopify?', 'How do I share a folder with an agency?', 'What counts as a design?', 'Why is my photo in Review?', 'How do I connect Claude?'];
const POPULAR: [string, string][] = [['quick-start', 'Set up Mise in 10 minutes'], ['troubleshooting', 'Every message explained'], ['plans', 'Plans: Free, Pro and Enterprise'], ['products', 'Products: Shopify, feeds and CSV'], ['claude-connector', 'Connect Claude'], ['team-and-roles', 'Team, invites and roles']];

// Settings → Help: ask in your own words; answers come from the help centre, with links.
export default function HelpAsk({ wsId, onFeedback }: { wsId?: string; onFeedback: () => void }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [turns, setTurns] = useState<{ q: string; a: string }[]>([]);
  const box = useRef<HTMLTextAreaElement>(null);

  async function ask(question = q) {
    const text = question.trim();
    if (!text || busy) return;
    setBusy(true); setErr('');
    const r = await fetch('/api/help/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: text, workspace_id: wsId, history: turns.slice(-4) }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (!r?.ok) { setErr(j.error || 'Couldn’t get an answer just now. Try again.'); return; }
    setTurns((t) => [...t, { q: text, a: j.answer }]);
    setQ('');
    setTimeout(() => box.current?.focus(), 50);
  }
  // Article links open the help centre in a new tab.
  const html = (a: string) => markdown(a, '/help').replace(/<a href="\/help/g, '<a target="_blank" rel="noreferrer" href="/help');

  return (
    <div className="settings help-ask">
      <h2>Help</h2>
      <p className="tip">Ask anything about Mise in your own words. Answers come from the <a href="/help" target="_blank" rel="noreferrer">help centre</a>, with links to the full article.</p>

      {turns.map((t, i) => (
        <div key={i} className="ha-turn">
          <div className="ha-q">{t.q}</div>
          <div className="ha-a hc-body" dangerouslySetInnerHTML={{ __html: html(t.a) }} />
        </div>
      ))}

      <form className="ha-form" onSubmit={(e) => { e.preventDefault(); ask(); }}>
        <textarea ref={box} className="in" rows={2} value={q} onChange={(e) => setQ(e.target.value)} autoFocus
          placeholder={turns.length ? 'Ask a follow-up…' : 'e.g. How do I set a licence end date on a photo?'}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }} aria-label="Your question" />
        <button className="primary" type="submit" disabled={busy || !q.trim()}>{busy ? 'Looking it up…' : 'Ask'}</button>
      </form>
      {err && <p className="err">{err}</p>}
      {!turns.length && (
        <div className="ha-starters">{STARTERS.map((s) => <button key={s} type="button" className="cr-try" onClick={() => ask(s)} disabled={busy}>{s}</button>)}</div>
      )}

      <div className="ha-more">
        <div>
          <div className="label">Popular articles</div>
          <ul>{POPULAR.map(([slug, t]) => <li key={slug}><a href={`/help/${slug}`} target="_blank" rel="noreferrer">{t}</a></li>)}</ul>
          <a className="btn" href="/help" target="_blank" rel="noreferrer">Browse the help centre</a>
        </div>
        <div>
          <div className="label">Still stuck?</div>
          <p className="tip">Tell us what you did and what happened. Mise includes the page you’re on.</p>
          <button className="btn" type="button" onClick={onFeedback}>Send feedback</button>
        </div>
      </div>
    </div>
  );
}
