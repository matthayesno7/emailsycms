'use client';
import { useCallback, useEffect, useState } from 'react';
import { Icon } from './icons';
import { openUpgrade } from './Billing';

type Feed = { id: string; kind: 'url' | 'shopify'; source: string; name: string | null; last_synced_at: string | null; last_status: string | null; last_count: number | null };
type Way = 'csv' | 'url' | 'shopify';

const ago = (d: string | null) => {
  if (!d) return 'not synced yet';
  const m = Math.round((Date.now() - new Date(d).getTime()) / 60000);
  return m < 1 ? 'synced just now' : m < 60 ? `synced ${m} min ago` : m < 1440 ? `synced ${Math.round(m / 60)} h ago` : `synced ${Math.round(m / 1440)} d ago`;
};

// Add products: one place for every way in. A CSV is a one-off; a feed link or a Shopify store
// stays in sync (daily on Pro).
export default function ProductFeeds({ ws, onCsv, onDone, toast }: {
  ws: string; onCsv: () => void; onDone: () => void; toast: (m: string) => void;
}) {
  const [way, setWay] = useState<Way>('shopify');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [daily, setDaily] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/feeds?workspace_id=${ws}`).catch(() => null);
    const j = r?.ok ? await r.json().catch(() => null) : null;
    if (j) { setFeeds(j.feeds || []); setDaily(!!j.daily); }
  }, [ws]);
  useEffect(() => { load(); }, [load]);

  const said = (r: any) => {
    const bits = [`${r.count.toLocaleString()} products`];
    if (r.added) bits.push(`${r.added} new`);
    if (r.removed) bits.push(`${r.removed} no longer in the feed`);
    return bits.join(' · ') + (r.images ? '. Fetching their images in the background.' : '.');
  };

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    setBusy('add'); setErr('');
    const r = await fetch('/api/feeds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace_id: ws, kind: way, source: value }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(null);
    if (!r?.ok) { setErr(j.error || 'Couldn’t read that. Check the link and try again.'); load(); return; }
    toast(said(j.result)); setValue(''); load(); onDone();
  }
  async function sync(f: Feed) {
    setBusy(f.id);
    const r = await fetch('/api/feeds', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace_id: ws, id: f.id }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(null); load();
    if (!r?.ok) { toast(j.error || 'Couldn’t sync. Try again.'); return; }
    toast(said(j.result)); onDone();
  }
  async function remove(f: Feed) {
    await fetch(`/api/feeds?workspace_id=${ws}&id=${f.id}`, { method: 'DELETE' }).catch(() => null);
    toast('Stopped syncing. The products stay in your library.'); load();
  }

  return (
    <div className="pfeeds">
      <h2>Add your products</h2>
      <p className="tip">Products come in with their images, prices and links, ready to use in designs and emails.</p>

      <div className="pf-ways" role="group" aria-label="How to add products">
        {([['shopify', 'Connect Shopify', 'Your store’s products, kept in sync', <Icon.Bag key="i" />], ['url', 'Feed link', 'Google Merchant or any CSV/XML link, kept in sync', <Icon.Plug key="i" />], ['csv', 'Upload a CSV', 'A one-off file from Shopify, Google Merchant…', <Icon.Table key="i" />]] as [Way, string, string, React.ReactNode][]).map(([k, t, s, ic]) => (
          <button key={k} type="button" className="src" aria-pressed={way === k} onClick={() => { setWay(k); setErr(''); setValue(''); }}>
            {ic}<span><b>{t}</b><small>{s}</small></span>
          </button>
        ))}
      </div>

      {way === 'csv' ? (
        <div className="pf-form">
          <p className="tip">Needs a product ID column (id, sku or item_id). Title, price, link, image and description are picked up if they’re there.</p>
          <div className="actions left"><button className="primary" type="button" onClick={onCsv}>Choose a CSV file</button></div>
        </div>
      ) : (
        <form className="pf-form" onSubmit={add}>
          <label className="bl" htmlFor="pf-in"><span>{way === 'shopify' ? 'Your store’s address' : 'Feed link'}</span></label>
          <div className="pf-row">
            <input id="pf-in" className="in" value={value} onChange={(e) => setValue(e.target.value)} autoFocus
              placeholder={way === 'shopify' ? 'yourstore.com' : 'https://…'} inputMode="url" autoComplete="off" />
            <button className="primary" type="submit" disabled={!!busy || !value.trim()}>{busy === 'add' ? (way === 'shopify' ? 'Reading your store…' : 'Reading the feed…') : way === 'shopify' ? 'Connect' : 'Import'}</button>
          </div>
          {err && <p className="err">{err}</p>}
          <p className="tip">{way === 'shopify'
            ? 'Mise reads your store’s published products: names, images, prices and links. Nothing to install, and Mise never changes your store.'
            : 'Google Merchant: Products → Feeds → your feed → copy its link. A Google Sheet works too (File → Share → Publish to web → CSV).'}</p>
        </form>
      )}

      {feeds.length > 0 && (
        <div className="pf-list">
          <div className="label">Kept in sync</div>
          {feeds.map((f) => (
            <div key={f.id} className="row">
              {f.kind === 'shopify' ? <Icon.Bag size={16} /> : <Icon.Plug size={16} />}
              <span className="grow"><b>{f.name || f.source}</b>{' '}
                <span className="muted">{f.last_count != null ? `${f.last_count.toLocaleString()} products · ` : ''}{ago(f.last_synced_at)}</span>
                {f.last_status && f.last_status !== 'ok' && <span className="err"> · {f.last_status}</span>}
              </span>
              <button className="btn quiet" type="button" disabled={!!busy} onClick={() => sync(f)}>{busy === f.id ? 'Syncing…' : 'Sync now'}</button>
              <button className="btn quiet" type="button" onClick={() => remove(f)}>Stop syncing</button>
            </div>
          ))}
          <p className="tip">{daily ? 'Mise checks these every day for new products, price changes and products that have gone (they’re marked no longer available, not deleted).'
            : <>On Pro, Mise checks these every day. On Free, press Sync now when your products change. <button type="button" className="linkish" onClick={() => openUpgrade({ reason: 'general' })}>Upgrade</button></>}</p>
        </div>
      )}
    </div>
  );
}
