'use client';
import { useCallback, useEffect, useState } from 'react';
import { openUpgrade } from './Billing';
import { FREE_FILES } from '@/lib/plans';

type P = { search_enabled?: boolean; searchable?: number; search_waiting?: number; enabled: boolean; organised: number; waiting: number; failed: number; not_yet: number; paused?: number; total: number; cost_per_file_gbp: number; errors?: { id: string; name: string; ai_error: string }[] };

const nextMonth = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 1).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }); };
const gbp = (n: number) => (n < 1 ? `${Math.max(1, Math.round(n * 100))}p` : `£${n < 10 ? n.toFixed(2) : Math.round(n)}`);

// Settings → Auto-organise: what's been organised, and the backfill for older files.
export default function AutoOrganise({ ws, toast, canUpgrade }: { ws: string; toast: (m: string) => void; canUpgrade?: boolean }) {
  const [p, setP] = useState<P | null>(null);
  const [busy, setBusy] = useState(false);
  const [usage, setUsage] = useState<{ kind: string; label: string; used: number; cap: number }[] | null>(null);
  const [plan, setPlan] = useState<string>('free');
  useEffect(() => {
    fetch(`/api/usage?workspace_id=${ws}`).then((r) => (r.ok ? r.json() : null)).then((j) => { setUsage(j?.usage || null); if (j?.plan) setPlan(j.plan); }).catch(() => {});
  }, [ws, p?.organised]);
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
  }, [p?.waiting, load]);

  async function act(action: 'backfill' | 'retry' | 'kick') {
    setBusy(true);
    const r = await fetch('/api/jobs/tag', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace_id: ws, action }) }).catch(() => null);
    setBusy(false);
    const j = r ? await r.json().catch(() => null) : null;
    if (!r?.ok) { toast(j?.error || 'Couldn’t start. Try again.'); return; }
    setP((cur) => ({ ...(cur as P), ...j }));
    if (action === 'backfill') toast('Organising your library. You can keep working.');
  }

  if (!p) return <div className="settings"><h2>Auto-organise</h2><p className="tip">Loading…</p></div>;
  const pct = p.total ? Math.round((p.organised / p.total) * 100) : 0;
  return (
    <div className="settings autoorg">
      <h2>Auto-organise</h2>
      <p className="tip">Every image, logo and product photo gets a description, tags, its colours (matched to your brand kit), any text in it, an on-brand check against your imagery rules, and a link to the product it shows. It happens a few seconds after upload. Edit tags or descriptions on any asset: your edits always win.</p>
      {!p.enabled && <p className="err">Turned off: add ANTHROPIC_API_KEY to the server (Railway → Variables) and redeploy.</p>}

      {/* Status of the library, not a limit: uploads are unlimited on every plan. */}
      {p.organised === p.total && p.total > 0 ? (
        <p className="ao-done">All {p.total.toLocaleString()} file{p.total === 1 ? ' is' : 's are'} organised and searchable.</p>
      ) : (
        <>
          <div className="ao-meter" aria-label={`${pct}% organised`}><i style={{ width: `${pct}%` }} /></div>
          <div className="ao-stats">
            <span><b>{p.organised.toLocaleString()}</b> of {p.total.toLocaleString()} files organised</span>
            {p.waiting > 0 && <span><b>{p.waiting.toLocaleString()}</b> in progress…</span>}
            {p.not_yet > 0 && <span><b>{p.not_yet.toLocaleString()}</b> not organised yet</span>}
            {!!p.paused && <span><b>{p.paused.toLocaleString()}</b> waiting until the 1st</span>}
            {p.failed > 0 && <span className="bad"><b>{p.failed}</b> couldn’t be read</span>}
          </div>
        </>
      )}

      <div className="actions left">
        {p.not_yet > 0 && <button className="primary" type="button" disabled={busy || !p.enabled} onClick={() => act('backfill')}>
          {busy ? 'Starting…' : `Organise ${p.not_yet.toLocaleString()} older file${p.not_yet === 1 ? '' : 's'}`}
        </button>}
        {p.failed > 0 && <button className="btn" type="button" disabled={busy || !p.enabled} onClick={() => act('retry')}>Try the failed ones again</button>}
        {p.waiting > 0 && <button className="btn quiet" type="button" disabled={busy || !p.enabled} onClick={() => act('kick')}>Speed up</button>}
      </div>
      {!!p.paused && (
        <div className="limit-banner">
          <span>Free organises 500 files a month. Your other {p.paused.toLocaleString()} file{p.paused === 1 ? ' is' : 's are'} uploaded and ready to use, and will be organised from {nextMonth()}.</span>
          {canUpgrade && <span className="acts"><button className="btn" type="button" onClick={() => openUpgrade({ reason: 'organise', count: p.paused })}>Organise them now with Pro</button></span>}
        </div>
      )}
      {p.not_yet > 0 && <p className="tip">About {gbp(p.not_yet * p.cost_per_file_gbp)} in Claude usage for {p.not_yet.toLocaleString()} files (roughly {gbp(1000 * p.cost_per_file_gbp)} per 1,000). It runs in the background at a steady pace.</p>}
      {!!p.errors?.length && (
        <div className="ao-errors">
          <div className="label">Recent problems</div>
          {p.errors.map((e) => <div key={e.id} className="tip"><b>{e.name}</b>: {e.ai_error}</div>)}
        </div>
      )}
      <div className="ao-search">
        <div className="label">AI search</div>
        {p.search_enabled
          ? <p className="tip"><b>{(p.searchable || 0).toLocaleString()}</b> files searchable by meaning{p.search_waiting ? `, ${p.search_waiting.toLocaleString()} being added…` : ''}. Try “woman outdoors with a blue bag” or “red product shots, landscape”.</p>
          : <p className="tip">Searching by meaning is off: add VOYAGE_API_KEY on the server. Search still matches names, tags and descriptions.</p>}
      </div>
      {usage && (
        <div className="ao-usage">
          {(() => {
            const u = usage.find((x) => x.kind === 'tag');
            if (plan !== 'free' || !u) return <p className="tip">Uploads are unlimited, and every new file is organised as soon as it’s added.</p>;
            return <p className="tip">Free includes {FREE_FILES} files, every one organised and searchable. Start your free Pro trial to bring in the rest of your library.</p>;
          })()}
        </div>
      )}
      <p className="tip">Not used: face recognition. Mise never identifies people from their faces.</p>
    </div>
  );
}
