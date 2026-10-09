'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { originAllowed } from '@/lib/sites';

// The Mise picker, embedded in another tool (iframe) or opened from it (pop-up). People search the
// brand's approved library, pick, and the tool receives the files with permanent links:
//   { source: 'mise', type: 'mise:select', assets: [...] }   also 'mise:ready' and 'mise:cancel'
// Results only ever go to the page that embedded or opened the picker, and only if it's one of the
// key's allowed sites. Opened on its own (no tool around it), it's a test page.
// A tool may send { type: 'mise:hello' } first; the picker then answers its origin even without a referrer.
type Item = { id: string; name: string; type: string; mime: string | null; width: number | null; height: number | null; thumb: string; alt: string; pid: string | null; price: string | null };
const LABEL: Record<string, string> = { all: 'All', image: 'Images', logo: 'Logos', product: 'Products', video: 'Videos' };

function host() {
  if (typeof window === 'undefined') return { target: null as Window | null, origin: null as string | null, mode: 'test' as const };
  const ref = () => { try { return document.referrer ? new URL(document.referrer).origin : null; } catch { return null; } };
  if (window.parent !== window) {
    const ao = (window.location as any).ancestorOrigins as DOMStringList | undefined;
    return { target: window.parent, origin: (ao && ao.length ? ao[0] : null) || ref(), mode: 'frame' as const };
  }
  if (window.opener) return { target: window.opener as Window, origin: ref(), mode: 'popup' as const };
  return { target: null, origin: null, mode: 'test' as const };
}

export default function Picker({ pickerKey, brand, sites, multiple, types }: { pickerKey: string; brand: string; sites: string[]; multiple: boolean; types: string[] }) {
  const [h, setH] = useState<ReturnType<typeof host> | null>(null);
  const [q, setQ] = useState('');
  const [tab, setTab] = useState('all');
  const [items, setItems] = useState<Item[]>([]);
  const [more, setMore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState('');
  const [result, setResult] = useState<any[] | null>(null);
  const seq = useRef(0);

  useEffect(() => { setH(host()); }, []);
  // A tool can also say hello (mise.js does): its message names its origin reliably, even when the
  // browser hides where the picker is embedded (no referrer, no ancestorOrigins).
  useEffect(() => {
    const hello = (e: MessageEvent) => {
      if (e.data?.type !== 'mise:hello' || !originAllowed(e.origin, sites)) return;
      setH((cur) => (cur && cur.target && e.source === cur.target && cur.origin !== e.origin ? { ...cur, origin: e.origin } : cur));
    };
    window.addEventListener('message', hello);
    return () => window.removeEventListener('message', hello);
  }, [sites]);
  // Not told where it's embedded yet: give a tool's hello a moment before saying no.
  const [waited, setWaited] = useState(false);
  useEffect(() => { const t = setTimeout(() => setWaited(true), 1500); return () => clearTimeout(t); }, []);
  const blocked = !!h && h.mode !== 'test' && (h.origin ? !originAllowed(h.origin, sites) : waited);
  const post = useCallback((msg: Record<string, any>) => {
    if (!h?.target || !h.origin || blocked) return;
    h.target.postMessage({ source: 'mise', ...msg }, h.origin);
  }, [h, blocked]);
  useEffect(() => { if (h && !blocked) post({ type: 'mise:ready', multiple, brand }); }, [h, blocked, post, multiple, brand]);

  const load = useCallback(async (offset = 0) => {
    const n = ++seq.current;
    setLoading(true); setErr('');
    const p = new URLSearchParams({ key: pickerKey, type: tab, types: types.join(','), offset: String(offset) });
    if (q.trim()) p.set('q', q.trim());
    const r = await fetch(`/api/picker/assets?${p}`).catch(() => null);
    const j = await r?.json().catch(() => null);
    if (n !== seq.current) return;
    setLoading(false);
    if (!r?.ok || !j) { setErr(j?.error || 'Couldn’t load the library. Try again.'); return; }
    setItems((cur) => (offset ? [...cur, ...j.assets] : j.assets));
    setMore(j.more ? j.next : null);
  }, [pickerKey, tab, types, q]);
  useEffect(() => { const t = setTimeout(() => load(0), q ? 250 : 0); return () => clearTimeout(t); }, [load, q]);

  const cancel = useCallback(() => { post({ type: 'mise:cancel' }); setPicked([]); }, [post]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [cancel]);

  function toggle(id: string) {
    setSent('');
    setPicked((cur) => (multiple ? (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].slice(0, 50)) : cur[0] === id ? [] : [id]));
  }

  async function insert(ids = picked) {
    if (!ids.length || busy || blocked) return;
    setBusy(true); setErr('');
    const r = await fetch('/api/picker/select', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: pickerKey, ids, origin: h?.mode === 'test' ? 'test' : h?.origin }) }).catch(() => null);
    const j = await r?.json().catch(() => null);
    setBusy(false);
    if (!r?.ok || !j?.assets) { setErr(j?.error || 'Couldn’t add those files. Try again.'); return; }
    if (h?.mode === 'test') { setResult(j.assets); return; }
    post({ type: 'mise:select', assets: j.assets });
    setSent(j.assets.length === 1 ? `Added “${j.assets[0].name}”.` : `Added ${j.assets.length} files.`);
    setPicked([]);
  }

  const tabs = useMemo(() => ['all', ...types], [types]);

  return (
    <main className="pk-shell">
      <header className="pk-top">
        <span className="pk-brand"><span className="wordmark">Mise<i aria-hidden /></span><b title={brand}>{brand}</b></span>
        <label className="pk-search">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, tag or what’s in it" aria-label="Search the library" autoFocus />
        </label>
      </header>
      {tabs.length > 2 && (
        <nav className="pk-tabs" aria-label="Type">
          {tabs.map((t) => <button key={t} type="button" aria-pressed={tab === t} onClick={() => { setTab(t); setPicked([]); }}>{LABEL[t] || t}</button>)}
        </nav>
      )}

      {blocked ? (
        <div className="pk-note"><b>This site can’t use this picker yet.</b><span>An admin can add <code>{h?.origin || 'this site'}</code> to the picker’s allowed sites in Mise › Settings › Integrations.</span></div>
      ) : (
        <div className="pk-body">
          {h?.mode === 'test' && <div className="pk-note test"><b>Test mode</b><span>This picker isn’t inside another tool, so picking shows what the tool would receive.</span></div>}
          {err && <p className="pk-err" role="alert">{err}</p>}
          {!loading && !err && !items.length && <p className="pk-empty">{q ? `Nothing matches “${q}”.` : 'No approved files here yet.'}</p>}
          <div className="pk-grid" aria-busy={loading}>
            {items.map((a) => {
              const on = picked.includes(a.id);
              return (
                <button key={a.id} type="button" className="pk-tile" aria-pressed={on} title={a.name}
                  onClick={() => toggle(a.id)} onDoubleClick={() => { if (!multiple) insert([a.id]); }}>
                  <span className={`pk-img${a.type === 'logo' ? ' logo' : ''}`}>
                    {a.type === 'video' ? <video src={a.thumb} muted preload="metadata" /> : a.thumb ? <img src={a.thumb} alt={a.alt} loading="lazy" /> : null}
                    <span className="pk-check" aria-hidden>{on ? (multiple ? picked.indexOf(a.id) + 1 : '✓') : ''}</span>
                  </span>
                  <span className="pk-name">{a.name}</span>
                  <span className="pk-meta">{[a.width && a.height ? `${a.width}×${a.height}` : '', a.price || ''].filter(Boolean).join(' · ') || LABEL[a.type]}</span>
                </button>
              );
            })}
            {loading && !items.length && Array.from({ length: 8 }).map((_, i) => <span key={i} className="pk-tile skel" aria-hidden><span className="pk-img" /></span>)}
          </div>
          {more !== null && <div className="pk-more"><button className="btn" type="button" disabled={loading} onClick={() => load(more)}>{loading ? 'Loading…' : 'Show more'}</button></div>}
          {result && (
            <section className="pk-result">
              <h2>What the tool receives</h2>
              {result.map((a) => <p key={a.id}><b>{a.name}</b><br /><a href={a.url} target="_blank" rel="noreferrer">{a.url}</a></p>)}
              <pre>{JSON.stringify({ source: 'mise', type: 'mise:select', assets: result }, null, 2)}</pre>
            </section>
          )}
        </div>
      )}

      <footer className="pk-bar">
        <span className="pk-count" aria-live="polite">{sent || (picked.length ? `${picked.length} selected` : multiple ? 'Pick one or more' : 'Pick a file')}</span>
        {h?.mode !== 'test' && <button className="btn quiet" type="button" onClick={cancel}>Cancel</button>}
        <button className="primary" type="button" disabled={!picked.length || busy || blocked} onClick={() => insert()}>
          {busy ? 'Adding…' : h?.mode === 'test' ? 'Show result' : multiple && picked.length > 1 ? `Insert ${picked.length}` : 'Insert'}
        </button>
      </footer>
    </main>
  );
}
