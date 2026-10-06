'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { HELP_ARTICLES } from '@/lib/helpArticles';

// Search across every help article: the box in the top bar opens it, and so do ⌘K, Ctrl+K and /.
// Anything else on the page can open it with window.dispatchEvent(new Event('hcx-search')).
export default function HelpSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const [mac, setMac] = useState(true);

  useEffect(() => {
    setMac(/Mac|iPhone|iPad/.test(navigator.platform));
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) { e.preventDefault(); setOpen(true); }
    };
    const show = () => setOpen(true);
    window.addEventListener('keydown', key);
    window.addEventListener('hcx-search', show);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('hcx-search', show); };
  }, []);

  useEffect(() => {
    if (!open) return;
    setSel(0);
    const t = setTimeout(() => input.current?.focus(), 0);
    document.body.style.overflow = 'hidden';
    return () => { clearTimeout(t); document.body.style.overflow = ''; };
  }, [open]);

  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = useMemo(() => {
    if (!words.length) return HELP_ARTICLES.filter((a) => ['quick-start', 'products', 'create-designs', 'share-links', 'claude-connector', 'plans', 'troubleshooting'].includes(a.slug));
    return HELP_ARTICLES.map((a) => {
      const hay = `${a.title} ${a.description} ${a.body}`.toLowerCase();
      const title = `${a.title} ${a.description}`.toLowerCase();
      if (!words.every((w) => hay.includes(w))) return null;
      const score = words.reduce((s, w) => s + (title.includes(w) ? 5 : 0) + hay.split(w).length - 1, 0);
      return { a, score };
    }).filter(Boolean).sort((x, y) => y!.score - x!.score).slice(0, 10).map((x) => x!.a);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = (slug: string) => { window.location.href = `/help/${slug}`; };

  return (
    <>
      <button type="button" className="hcx-search" onClick={() => setOpen(true)} aria-label="Search the help centre">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
        <span>Search…</span>
        <kbd>{mac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>
      {open && (
        <div className="hcx-modal" role="dialog" aria-modal="true" aria-label="Search the help centre" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
          <div className="hcx-panel">
            <div className="hcx-q">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input ref={input} value={q} placeholder="Search, e.g. “connect Shopify” or “share a folder”" aria-label="Search"
                onChange={(e) => { setQ(e.target.value); setSel(0); }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setOpen(false);
                  else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length - 1)); }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
                  else if (e.key === 'Enter' && hits[sel]) go(hits[sel].slug);
                }} />
              <button type="button" className="hcx-esc" onClick={() => setOpen(false)}>Esc</button>
            </div>
            <div className="hcx-hits">
              {!words.length && <p className="hcx-hint">Popular</p>}
              {hits.length ? hits.map((a, i) => (
                <a key={a.slug} href={`/help/${a.slug}`} className={i === sel ? 'on' : undefined} onMouseEnter={() => setSel(i)}>
                  <small>{a.category}</small><b>{a.title}</b><span>{a.description}</span>
                </a>
              )) : <p className="hcx-none">Nothing matches “{q}”. Try other words, or open Mise and ask under <b>Help</b>.</p>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
