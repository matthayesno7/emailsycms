'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

type P = { enabled: boolean; organised: number; waiting: number; failed: number; not_yet: number; paused?: number; total: number; search_waiting?: number; errors?: { id: string; name: string; ai_error: string }[] };

// Top of Assets: a slim live strip while Mise is organising new files, with the full detail in
// Settings › Plan & usage › Library. Hidden when everything's organised (after a moment's "done").
export default function LibrarySync({ ws, nudge, onProgress, onDetails, toast }: {
  ws: string; nudge: number; // changes when files are added, so the strip wakes up
  onProgress: () => void; onDetails: () => void; toast: (m: string) => void;
}) {
  const [p, setP] = useState<P | null>(null);
  const [justDone, setJustDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const last = useRef<number | null>(null);
  const progress = useRef(onProgress);
  progress.current = onProgress;

  const load = useCallback(async () => {
    const r = await fetch(`/api/jobs/tag?workspace_id=${ws}`).catch(() => null);
    if (!r?.ok) return;
    const j: P = await r.json();
    // New tags have landed: refresh the grid so they show.
    if (last.current !== null && j.organised !== last.current) progress.current();
    if (last.current !== null && last.current < j.total && j.organised === j.total && !j.waiting) { setJustDone(true); setTimeout(() => setJustDone(false), 5000); }
    last.current = j.organised;
    setP(j);
  }, [ws]);

  useEffect(() => { last.current = null; load(); }, [load, nudge]);
  useEffect(() => {
    if (!p?.waiting && !p?.search_waiting) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [p?.waiting, p?.search_waiting, load]);

  async function act(action: 'backfill' | 'retry') {
    setBusy(true);
    const r = await fetch('/api/jobs/tag', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace_id: ws, action }) }).catch(() => null);
    setBusy(false);
    const j = r ? await r.json().catch(() => null) : null;
    if (!r?.ok) { toast(j?.error || 'Couldn’t start. Try again.'); return; }
    setP((cur) => ({ ...(cur as P), ...j }));
  }

  if (!p || !p.enabled || p.total === 0) return null;
  const working = p.waiting > 0;
  const show = working || p.failed > 0 || p.not_yet > 0 || !!p.paused || justDone;
  if (!show) return null;
  const pct = Math.round((p.organised / p.total) * 100);

  return (
    <div className={'lsync' + (working ? ' on' : '') + (justDone ? ' done' : '')} role="status" aria-live="polite">
      <span className="lsync-dot" aria-hidden />
      <span className="lsync-text">
        {justDone && !working ? <b>All {p.total.toLocaleString()} organised and searchable.</b>
          : working ? <><b>Organising {p.waiting.toLocaleString()} file{p.waiting === 1 ? '' : 's'}…</b> <span className="muted">{p.organised.toLocaleString()} of {p.total.toLocaleString()} done</span></>
          : <><b>{p.organised.toLocaleString()} of {p.total.toLocaleString()} organised.</b></>}
        {!working && p.failed > 0 && <span className="bad"> {p.failed} couldn’t be read.</span>}
        {!working && p.not_yet > 0 && <span className="muted"> {p.not_yet.toLocaleString()} older file{p.not_yet === 1 ? '' : 's'} not organised yet.</span>}
        {!working && !!p.paused && <span className="muted"> {p.paused.toLocaleString()} waiting until the 1st.</span>}
      </span>
      <span className="lsync-meter" aria-hidden><i style={{ width: `${pct}%` }} /></span>
      {!working && p.failed > 0 && <button className="btn quiet" type="button" disabled={busy} onClick={() => act('retry')}>Try again</button>}
      {!working && p.not_yet > 0 && <button className="btn quiet" type="button" disabled={busy} onClick={() => act('backfill')}>Organise them</button>}
      <button className="linkish" type="button" onClick={onDetails}>Details</button>
    </div>
  );
}
