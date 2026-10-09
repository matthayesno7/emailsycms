'use client';
import { useCallback, useEffect, useState } from 'react';
import { openUpgrade } from './Billing';
import type { Ws } from './Library';

// Settings › Integrations: keys that let other tools (Bloomreach, a CMS, an email builder) show the
// Mise picker and get permanent links to approved files. Admins and owners; Pro and Enterprise.
type Key = { id: string; name: string; key_prefix: string; origins: string[]; created_at: string; last_used_at: string | null; revoked_at: string | null };
const when = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Never');
const show = (o: string) => o.replace(/^https:\/\//, ''); // http:// stays visible, so it's clear which is which

export default function Integrations({ ws, toast }: { ws: Ws; toast: (m: string) => void }) {
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [plan, setPlan] = useState('free');
  const [name, setName] = useState('');
  const [sites, setSites] = useState('');
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<{ key: string; name: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editSites, setEditSites] = useState('');
  const [showOff, setShowOff] = useState(false);
  const origin = typeof window === 'undefined' ? 'https://app.misedam.com' : window.location.origin;

  const load = useCallback(async () => {
    const r = await fetch(`/api/integrations?workspace_id=${ws.id}`).catch(() => null);
    const j = await r?.json().catch(() => null);
    if (!r?.ok) { toast(j?.error || 'Couldn’t load integrations.'); setKeys([]); return; }
    setKeys(j.keys); setPlan(j.plan);
  }, [ws.id, toast]);
  useEffect(() => { load(); }, [load]);

  const copy = async (t: string, what = 'Copied') => { try { await navigator.clipboard.writeText(t); toast(what); } catch { toast(t); } };
  const call = async (method: 'POST' | 'PATCH', body: Record<string, any>) => {
    setBusy(true);
    const r = await fetch('/api/integrations', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace_id: ws.id, ...body }) }).catch(() => null);
    const j = await r?.json().catch(() => null);
    setBusy(false);
    if (j?.code === 'plan') { openUpgrade({ reason: 'integrations' }); return null; }
    if (!r?.ok) { toast(j?.error || 'Something went wrong. Try again.'); return null; }
    return j;
  };

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const j = await call('POST', { name, sites: sites.split(/[\s,]+/).filter(Boolean) });
    if (!j) return;
    setFresh({ key: j.key, name: j.row.name }); setName(''); setSites(''); load();
  }
  async function saveSites(id: string) {
    const j = await call('PATCH', { id, sites: editSites.split(/[\s,]+/).filter(Boolean) });
    if (j) { setEditing(null); toast('Sites saved'); load(); }
  }
  async function turnOff(k: Key) {
    if (!confirm(`Turn off “${k.name}”? The picker stops working in that tool straight away. Links to files it already added keep working.`)) return;
    if (await call('PATCH', { id: k.id, off: true })) { toast(`${k.name} turned off`); load(); }
  }

  if (!keys) return <div className="settings"><h2>Integrations</h2><p className="tip">Loading…</p></div>;
  const live = keys.filter((k) => !k.revoked_at);
  const off = keys.filter((k) => k.revoked_at);
  const pro = plan !== 'free';
  const url = (key: string, multiple = true) => `${origin}/picker?key=${key}${multiple ? '&multiple=1' : ''}`;

  return (
    <div className="settings integ">
      <h2>Integrations</h2>
      <p className="tip">Let other tools use your library. Bloomreach, your CMS or email builder can show the Mise picker, so people choose approved files without leaving that tool. Each file comes with a permanent link that always shows the latest version and stops working if the file is archived or its licence runs out. <a href="/help/integrations" target="_blank" rel="noreferrer">How it works</a></p>

      {!pro && (
        <div className="integ-up">
          <b>Integrations are on Pro</b>
          <span>Upgrade {ws.name} to use the Mise picker in other tools.</span>
          <button className="primary" type="button" onClick={() => openUpgrade({ reason: 'integrations' })}>Upgrade</button>
        </div>
      )}

      {fresh && (
        <section className="integ-fresh">
          <h3>Your key for {fresh.name}</h3>
          <p className="tip">Shown once. Give it to whoever sets up the tool. It only opens the picker on the sites you listed, and only shows approved files.</p>
          <div className="keybox">{fresh.key}</div>
          <div className="actions">
            <button className="primary" type="button" onClick={() => copy(fresh.key, 'Key copied')}>Copy key</button>
            <button className="btn" type="button" onClick={() => copy(url(fresh.key), 'Picker link copied')}>Copy picker link</button>
            <a className="btn" href={url(fresh.key)} target="_blank" rel="noreferrer">Test the picker</a>
            <button className="btn quiet" type="button" onClick={() => setFresh(null)}>Done</button>
          </div>
          <div className="label">To embed it, the tool loads this page in an iframe:</div>
          <div className="cmd"><code>{url(fresh.key)}</code><button className="btn quiet" type="button" onClick={() => copy(url(fresh.key))}>Copy</button></div>
          <p className="tip">Developers: the <a href="/help/integrations#for-developers" target="_blank" rel="noreferrer">integration guide</a> has the messages the picker sends and a ready-made script.</p>
        </section>
      )}

      {pro && (
        <form className="integ-new" onSubmit={create}>
          <h3>Add a tool</h3>
          <label className="label" htmlFor="ik-name">Name</label>
          <input id="ik-name" className="in" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bloomreach" required />
          <label className="label" htmlFor="ik-sites">Sites that show the picker</label>
          <textarea id="ik-sites" className="in mono" rows={3} value={sites} onChange={(e) => setSites(e.target.value)} placeholder={'*.bloomreach.com\napp.exponea.com'} required />
          <p className="tip">One per line. <code>*.example.com</code> covers every subdomain; add <code>example.com</code> too if the tool uses it. Addresses are https unless you write <code>http://</code> (for local testing, <code>localhost:8000</code> is http). Ask the tool’s team if you’re not sure.</p>
          <div className="actions"><button className="primary" type="submit" disabled={busy || !name.trim() || !sites.trim()}>{busy ? 'Creating…' : 'Create key'}</button></div>
        </form>
      )}

      {live.length > 0 && (
        <>
          <div className="label">Connected tools</div>
          <div className="rows integ-rows">
            {live.map((k) => (
              <div className="row integ-row" key={k.id}>
                <div className="grow">
                  <b>{k.name}</b> <code className="muted">{k.key_prefix}…</code>
                  {editing === k.id ? (
                    <div className="integ-edit">
                      <textarea className="in mono" rows={3} value={editSites} onChange={(e) => setEditSites(e.target.value)} aria-label={`Sites for ${k.name}`} />
                      <div className="actions"><button className="primary" type="button" disabled={busy} onClick={() => saveSites(k.id)}>Save</button><button className="btn quiet" type="button" onClick={() => setEditing(null)}>Cancel</button></div>
                    </div>
                  ) : (
                    <div className="integ-sites">{k.origins.map(show).join(' · ')}</div>
                  )}
                  <div className="muted">Added {when(k.created_at)} · Last used {when(k.last_used_at)}</div>
                </div>
                {editing !== k.id && (
                  <div className="actions">
                    {pro && <button className="btn quiet" type="button" onClick={() => { setEditing(k.id); setEditSites(k.origins.map(show).join('\n')); }}>Edit sites</button>}
                    <button className="btn quiet" type="button" onClick={() => turnOff(k)}>Turn off</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
      {off.length > 0 && (
        <button className="linkish" type="button" onClick={() => setShowOff(!showOff)}>{showOff ? 'Hide' : 'Show'} {off.length} turned off</button>
      )}
      {showOff && off.map((k) => <p key={k.id} className="tip">{k.name} <code>{k.key_prefix}…</code> · turned off {when(k.revoked_at)}</p>)}
      <p className="tip">Every pick is in the Activity log on Enterprise. A key only reads approved, available files; it can’t change anything.</p>
    </div>
  );
}
