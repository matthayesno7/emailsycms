'use client';
import { useCallback, useEffect, useState } from 'react';

type P = { search_enabled?: boolean; searchable?: number; search_waiting?: number; enabled: boolean; organised: number; waiting: number; failed: number; not_yet: number; paused?: number; total: number; cost_per_file_gbp: number; errors?: { id: string; name: string; ai_error: string }[] };

const gbp = (n: number) => (n < 1 ? `${Math.max(1, Math.round(n * 100))}p` : `£${n < 10 ? n.toFixed(2) : Math.round(n)}`);
const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString()} ${n === 1 ? one : many}`;

// Settings → Plan & usage → Library: how organised and searchable the library is, and the
// buttons for older or failed files. (Plan limits live in the plan card above it.)
export default function AutoOrganise({ ws, toast }: { ws: string; toast: (m: string) => void }) {
  const [p, setP] = useState<P | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const r = await fetch(`/api/jobs/tag?workspace_id=${ws}`).catch(() => null);
    if (r?.ok) setP(await r.json());
  }, [ws]);
  useEffect(() => { load(); }, [load]);
  // Live progress while anything is waiting.
  useEffect(() => {
    if (!p?.waiting && !p?.search_waiting) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [p?.waiting, p?.search_waiting, load]);

  async function act(action: 'backfill' | 'retry' | 'kick') {
    setBusy(true);
    const r = await fetch('/api/jobs/tag', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace_id: ws, action }) }).catch(() => null);
    setBusy(false);
    const j = r ? await r.json().catch(() => null) : null;
    if (!r?.ok) { toast(j?.error || 'Couldn’t start. Try again.'); return; }
    setP((cur) => ({ ...(cur as P), ...j }));
    if (action === 'backfill') toast('Organising your library. You can keep working.');
  }

  if (!p) return <section className="plan-sec"><h3>Library</h3><p className="tip">Loading…</p></section>;
  const done = p.total > 0 && p.organised === p.total;
  const pct = p.total ? Math.round((p.organised / p.total) * 100) : 0;
  const search = p.search_enabled ? `${(p.searchable || 0).toLocaleString()} searchable by meaning${p.search_waiting ? ` (${p.search_waiting.toLocaleString()} being added)` : ''}` : null;

  return (
    <section className="plan-sec autoorg">
      <h3>Library</h3>
      {!p.enabled && <p className="err">Auto-organise is off: add ANTHROPIC_API_KEY to the server (Railway → Variables) and redeploy.</p>}

      <div className="lib-status">
        <span className={'lib-dot' + (done ? ' ok' : '')} aria-hidden />
        <div>
          <b>{p.total === 0 ? 'Nothing to organise yet.' : done ? `All ${plural(p.total, 'image and logo', 'images and logos')} organised.` : `${p.organised.toLocaleString()} of ${plural(p.total, 'image and logo', 'images and logos')} organised.`}</b>
          {search && <span className="muted"> {search}.</span>}
        </div>
      </div>

      {!done && p.total > 0 && (
        <>
          <div className="ao-meter" aria-label={`${pct}% organised`}><i style={{ width: `${pct}%` }} /></div>
          <div className="ao-stats">
            {p.waiting > 0 && <span><b>{p.waiting.toLocaleString()}</b> in progress…</span>}
            {p.not_yet > 0 && <span><b>{p.not_yet.toLocaleString()}</b> not organised yet</span>}
            {!!p.paused && <span><b>{p.paused.toLocaleString()}</b> waiting until the 1st</span>}
            {p.failed > 0 && <span className="bad"><b>{p.failed}</b> couldn’t be read</span>}
          </div>
          <div className="actions left">
            {p.not_yet > 0 && <button className="primary" type="button" disabled={busy || !p.enabled} onClick={() => act('backfill')}>{busy ? 'Starting…' : `Organise ${plural(p.not_yet, 'older file')}`}</button>}
            {p.failed > 0 && <button className="btn" type="button" disabled={busy || !p.enabled} onClick={() => act('retry')}>Try the failed ones again</button>}
            {p.waiting > 0 && <button className="btn quiet" type="button" disabled={busy || !p.enabled} onClick={() => act('kick')}>Speed up</button>}
          </div>
          {p.not_yet > 0 && <p className="tip">About {gbp(p.not_yet * p.cost_per_file_gbp)} in Claude usage for {plural(p.not_yet, 'file')}. It runs in the background.</p>}
        </>
      )}

      {!!p.errors?.length && (
        <div className="ao-errors">
          <div className="label">Recent problems</div>
          {p.errors.map((e) => <div key={e.id} className="tip"><b>{e.name}</b>: {e.ai_error}</div>)}
        </div>
      )}

      <p className="tip">Each image, logo and product photo gets a description, tags, its colours, any text in it, an on-brand check and a link to the product it shows, a few seconds after upload. Your edits always win. {p.search_enabled ? 'Search in plain English, like “woman outdoors with a blue bag”.' : 'Searching by meaning is off (VOYAGE_API_KEY); search still matches names, tags and descriptions.'} Mise never identifies people from their faces.</p>
    </section>
  );
}
