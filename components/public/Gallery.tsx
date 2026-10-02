'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PublicAsset, Section } from '@/lib/share';

type Ref = { s?: string; p?: string };
const LABEL: Record<string, string> = { original: 'Original', web: 'Web', email: 'Email-ready' };
const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

// The browsable grid on share links and portals: sections, search (the same AI search as the
// app, limited to what's shared), and a viewer with downloads in the allowed formats.
export default function Gallery({ assets, sections = [], shareRef, allowDownload, formats, searchable = true }: {
  assets: (PublicAsset & { tags?: string[] })[];
  sections?: Section[];
  shareRef: Ref;
  allowDownload: boolean;
  formats: string[];
  searchable?: boolean;
}) {
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const [ranked, setRanked] = useState<{ q: string; ids: string[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const byId = useMemo(() => new Map(assets.map((a) => [a.id, a])), [assets]);
  const qs = (o: Record<string, string>) => new URLSearchParams({ ...(shareRef.s ? { s: shareRef.s } : { p: shareRef.p! }), ...o }).toString();

  // Search: names and tags match instantly; the AI search re-orders a moment later.
  useEffect(() => {
    const t = q.trim();
    if (!t || !searchable) return;
    const timer = setTimeout(async () => {
      const r = await fetch('/api/public/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...shareRef, q: t }) }).catch(() => null);
      const j = r?.ok ? await r.json().catch(() => null) : null;
      if (j?.ids) setRanked({ q: t, ids: j.ids });
    }, 250);
    return () => clearTimeout(timer);
  }, [q, searchable]); // eslint-disable-line react-hooks/exhaustive-deps

  const inTab = useMemo(() => {
    if (tab === 'all') return assets;
    const s = sections.find((x) => x.id === tab);
    return s ? s.asset_ids.map((id) => byId.get(id)).filter(Boolean) as typeof assets : assets;
  }, [tab, assets, sections, byId]);

  const shown = useMemo(() => {
    const t = q.trim();
    if (!t) return inTab;
    const inT = new Set(inTab.map((a) => a.id));
    if (ranked && ranked.q === t) return ranked.ids.filter((id) => inT.has(id)).map((id) => byId.get(id)!).filter(Boolean);
    const words = norm(t).split(/\s+/);
    return inTab.filter((a) => { const h = norm(`${a.name} ${a.description} ${(a.tags || []).join(' ')} ${a.pid || ''}`); return words.every((w) => h.includes(w)); });
  }, [q, inTab, ranked, byId]);

  const cur = open ? byId.get(open) : null;
  const at = cur ? shown.findIndex((a) => a.id === cur.id) : -1;
  useEffect(() => {
    if (!cur) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null);
      if (e.key === 'ArrowRight' && at < shown.length - 1) setOpen(shown[at + 1].id);
      if (e.key === 'ArrowLeft' && at > 0) setOpen(shown[at - 1].id);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [cur, at, shown]);

  const fmts = (a: PublicAsset) => formats.filter((f) => (f === 'email' ? a.has_email : f === 'web' ? (a.width || 0) > 2000 : true));

  return (
    <div className="pub-gallery">
      <div className="pub-tools">
        {searchable && assets.length > 6 && (
          <label className="pub-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input type="search" placeholder="Search, e.g. “outdoors, summer” or “logo on dark”" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
          </label>
        )}
        {sections.length > 1 && (
          <div className="pub-tabs" role="tablist">
            <button type="button" aria-pressed={tab === 'all'} onClick={() => setTab('all')}>All <span>{assets.length}</span></button>
            {sections.map((s) => <button key={s.id} type="button" aria-pressed={tab === s.id} onClick={() => setTab(s.id)}>{s.name} <span>{s.asset_ids.length}</span></button>)}
          </div>
        )}
      </div>

      {!shown.length ? <p className="pub-empty">{q ? `Nothing matches “${q}”.` : 'Nothing here yet.'}</p> : (
        <div className="pub-grid">
          {shown.map((a) => (
            <button key={a.id} type="button" className={'pub-tile ' + a.kind} onClick={() => setOpen(a.id)} title={a.name}>
              <span className="pub-thumb" style={a.width && a.height && a.kind !== 'logo' ? { aspectRatio: `${Math.max(0.5, Math.min(3, a.width / a.height))}` } : undefined}>
                {a.kind === 'video' ? <video src={a.thumb} muted playsInline preload="metadata" /> : <img src={a.thumb} alt={a.alt} loading="lazy" />}
              </span>
              <span className="pub-cap">{a.name}</span>
            </button>
          ))}
        </div>
      )}

      {cur && (
        <div className="pub-viewer" role="dialog" aria-modal="true" aria-label={cur.name} onClick={(e) => { if (e.target === e.currentTarget) setOpen(null); }}>
          <div className="pub-viewer-in">
            <div className={'pub-big ' + cur.kind}>
              {cur.kind === 'video'
                ? <video src={cur.thumb} controls autoPlay muted playsInline />
                : <img src={`/api/public/file?${qs({ a: cur.id, f: cur.has_email && (cur.width || 0) <= 1200 ? 'email' : 'web' })}`} alt={cur.alt} />}
            </div>
            <aside className="pub-side">
              <button type="button" className="pub-x" aria-label="Close" onClick={() => setOpen(null)}>×</button>
              <h2>{cur.name}</h2>
              {cur.description && <p className="pub-desc">{cur.description}</p>}
              <p className="pub-meta">{[cur.width && `${cur.width}×${cur.height}`, cur.bytes && `${(cur.bytes / 1048576).toFixed(1)} MB`, cur.mime?.split('/')[1]?.toUpperCase()].filter(Boolean).join(' · ')}</p>
              {allowDownload ? (
                <div className="pub-dl">
                  {fmts(cur).map((f, i) => (
                    <a key={f} className={i === 0 ? 'pub-btn' : 'pub-btn ghost'} href={`/api/public/file?${qs({ a: cur.id, f, dl: '1' })}`}>
                      Download {LABEL[f]}{f === 'email' && cur.email_w ? ` (${cur.email_w}px)` : f === 'web' ? ' (2000px)' : ''}
                    </a>
                  ))}
                </div>
              ) : <p className="pub-meta">Viewing only: downloads are turned off for this link.</p>}
              <div className="pub-step">
                <button type="button" disabled={at <= 0} onClick={() => setOpen(shown[at - 1].id)}>← Previous</button>
                <span>{at + 1} of {shown.length}</span>
                <button type="button" disabled={at >= shown.length - 1} onClick={() => setOpen(shown[at + 1].id)}>Next →</button>
              </div>
            </aside>
          </div>
        </div>
      )}
    </div>
  );
}

export function Gate({ shareRef, mode, brandName }: { shareRef: Ref; mode: 'passcode' | 'signin'; brandName: string }) {
  const [v, setV] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  const [err, setErr] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState('busy'); setErr('');
    const r = await fetch(mode === 'passcode' ? '/api/public/unlock' : '/api/public/signin', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(mode === 'passcode' ? { ...shareRef, passcode: v } : { p: shareRef.p, email: v }),
    }).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    if (!r?.ok) { setErr(j?.error || 'Something went wrong. Try again.'); setState('idle'); return; }
    if (mode === 'passcode') location.reload(); else setState('sent');
  }
  if (state === 'sent') return <div className="pub-gate"><h1>Check your email</h1><p>If {v} has access to {brandName}’s portal, a sign-in link is on its way. Open it on this device.</p></div>;
  return (
    <form className="pub-gate" onSubmit={submit}>
      <h1>{mode === 'passcode' ? 'Enter the passcode' : `Sign in to ${brandName}’s portal`}</h1>
      <p>{mode === 'passcode' ? 'This is protected. The person who shared it can give you the passcode.' : 'This portal is for invited people. Enter your work email and we’ll send you a sign-in link.'}</p>
      <input ref={input} className="pub-in" type={mode === 'passcode' ? 'password' : 'email'} autoComplete={mode === 'passcode' ? 'off' : 'email'} value={v} onChange={(e) => setV(e.target.value)} placeholder={mode === 'passcode' ? 'Passcode' : 'you@company.com'} required />
      {err && <p className="pub-err">{err}</p>}
      <button className="pub-btn" type="submit" disabled={state === 'busy' || !v}>{state === 'busy' ? 'Checking…' : mode === 'passcode' ? 'Open' : 'Email me a link'}</button>
    </form>
  );
}

export function CopyChip({ value, label }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="pub-copy" onClick={async () => { try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1200); } catch {} }}>
      {done ? 'Copied' : label || value}
    </button>
  );
}
