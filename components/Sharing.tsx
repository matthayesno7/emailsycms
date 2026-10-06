'use client';
import { openUpgrade } from './Billing';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Asset, Ws } from './Library';
import { Icon } from './icons';

type Portal = Record<string, any> & { id: string; slug: string; name: string; access: string; published: boolean };
type Share = Record<string, any> & { id: string; token: string; title: string; kind: string };
type Ev = { portal_id: string | null; share_id: string | null; asset_id: string | null; event: string; email: string | null; at: string };
const FORMATS: [string, string][] = [['original', 'Original'], ['web', 'Web (2000px)'], ['email', 'Email-ready']];
const day = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

// Sharing: brand portals (public pages styled from the brand kit) and every share link.
export default function Sharing({ supabase, ws, items, folders, collections, toast, free = false }: {
  free?: boolean; // Free: portals can be built and previewed; publishing and links are on Pro
  supabase: SupabaseClient;
  ws: Ws;
  items: Asset[];
  folders: { id: string; name: string }[];
  collections: { id: string; name: string }[];
  toast: (m: string) => void;
}) {
  const [tab, setTab] = useState<'portals' | 'links'>('portals');
  const [slug, setSlug] = useState('');
  const [portals, setPortals] = useState<Portal[] | null>(null);
  const [shares, setShares] = useState<Share[] | null>(null);
  const [events, setEvents] = useState<Ev[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const origin = typeof location !== 'undefined' ? location.origin : '';

  const load = useCallback(async () => {
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const [w, p, s, e] = await Promise.all([
      supabase.from('workspaces').select('slug').eq('id', ws.id).maybeSingle(),
      supabase.from('portals').select('*').eq('workspace_id', ws.id).order('created_at'),
      supabase.from('shares').select('*').eq('workspace_id', ws.id).order('created_at', { ascending: false }).limit(500),
      supabase.from('share_events').select('portal_id, share_id, asset_id, event, email, at').eq('workspace_id', ws.id).gte('at', since).order('at', { ascending: false }).limit(5000),
    ]);
    setSlug(w.data?.slug || '');
    setPortals((p.data as Portal[]) || []);
    setShares((s.data as Share[]) || []);
    setEvents((e.data as Ev[]) || []);
  }, [supabase, ws.id]);
  useEffect(() => { load(); }, [load]);

  async function createPortal() {
    setBusy(true);
    const r = await fetch('/api/portals', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace_id: ws.id, name: `${ws.name} brand portal`, slug: 'brand' }) }).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    setBusy(false);
    if (!r?.ok || !j?.portal) { toast(j?.error || 'Couldn’t create the portal.'); return; }
    setPortals((ps) => [...(ps || []), j.portal]);
    if (j.ws_slug) setSlug(j.ws_slug);
    setEditing(j.portal.id);
    toast(free ? 'Your portal is ready to preview, styled from your brand kit' : 'Your portal is live, styled from your brand kit');
  }

  const cur = portals?.find((p) => p.id === editing) || null;
  const stats = (pred: (e: Ev) => boolean) => { const es = events.filter(pred); return { views: es.filter((e) => e.event === 'view').length, downloads: es.filter((e) => e.event === 'download').length }; };

  return (
    <div className="settings-page sharing">
      <div className="head"><h1>Sharing</h1></div>
      <div className="seg tabs" role="tablist">
        <button type="button" role="tab" aria-pressed={tab === 'portals'} onClick={() => setTab('portals')}>Brand portals</button>
        <button type="button" role="tab" aria-pressed={tab === 'links'} onClick={() => { setTab('links'); setEditing(null); }}>Links{shares?.filter((s) => live(s)).length ? ` · ${shares.filter((s) => live(s)).length}` : ''}</button>
      </div>

      {free && (
        <div className="upsell-strip" role="status">
          <span><b>Your team can preview portals.</b> Publishing them and sharing links is on Pro.</span>
          <button className="btn" type="button" onClick={() => openUpgrade({ reason: tab === 'links' ? 'share' : 'portal' })}>Upgrade to Pro</button>
        </div>
      )}
      {tab === 'portals' && (portals === null ? <p className="tip">Loading…</p> : cur ? (
        <PortalEditor key={cur.id} free={free} portal={cur} wsSlug={slug} origin={origin} folders={folders} collections={collections} items={items} events={events.filter((e) => e.portal_id === cur.id)} toast={toast}
          onBack={() => setEditing(null)}
          onSaved={(p) => setPortals((ps) => (ps || []).map((x) => (x.id === p.id ? p : x)))}
          onDelete={async () => { const { error } = await supabase.from('portals').delete().eq('id', cur.id); if (error) { toast('Couldn’t delete it.'); return; } setPortals((ps) => (ps || []).filter((x) => x.id !== cur.id)); setEditing(null); toast('Portal deleted'); }} />
      ) : !portals.length ? (
        <div className="portal-empty">
          <div className="pe-art"><Icon.Share size={26} /></div>
          <h2>Your brand portal is one click away</h2>
          <p className="tip">A public page with your approved logos, images and product shots, plus brand guidelines made from your brand kit. It’s styled with your logo, colours and fonts automatically. Share it with press, retailers and agencies.</p>
          <button className="primary" type="button" disabled={busy} onClick={createPortal}>{busy ? 'Creating…' : 'Create brand portal'}</button>
        </div>
      ) : (
        <div className="portal-list">
          {portals.map((p) => {
            const st = stats((e) => e.portal_id === p.id);
            return (
              <button key={p.id} type="button" className="portal-card" onClick={() => setEditing(p.id)}>
                <div className="pc-top"><b>{p.name}</b><span className={'badge ' + (p.published && !free ? 'on' : '')}>{p.published && !free ? 'Live' : free ? 'Preview only' : 'Unpublished'}</span></div>
                <code>{origin.replace(/^https?:\/\//, '')}/p/{slug}/{p.slug}</code>
                <div className="pc-stats"><span>{p.access === 'public' ? 'Public' : p.access === 'passcode' ? 'Passcode' : `Invite only (${p.allowlist?.length || 0})`}</span><span>{st.views} visits</span><span>{st.downloads} downloads</span><span className="muted">last 30 days</span></div>
              </button>
            );
          })}
          <button type="button" className="portal-card add" disabled={busy} onClick={createPortal}><Icon.Plus size={18} />New portal<small>e.g. Press, Retail partners, Agencies</small></button>
          <BrandAddress supabase={supabase} ws={ws} slug={slug} origin={origin} onChange={setSlug} toast={toast} />
        </div>
      ))}

      {tab === 'links' && (shares === null ? <p className="tip">Loading…</p> : (
        <Links shares={shares} origin={origin} items={items} folders={folders} collections={collections} toast={toast}
          onChanged={load}
          onDelete={async (id) => { const { error } = await supabase.from('shares').delete().eq('id', id); if (error) toast('Couldn’t delete it.'); else { setShares((ss) => (ss || []).filter((s) => s.id !== id)); toast('Link deleted'); } }} />
      ))}
    </div>
  );
}

const live = (s: Share) => !s.revoked_at && !(s.expires_at && new Date(s.expires_at) < new Date());

function BrandAddress({ supabase, ws, slug, origin, onChange, toast }: { supabase: SupabaseClient; ws: Ws; slug: string; origin: string; onChange: (s: string) => void; toast: (m: string) => void }) {
  const [edit, setEdit] = useState<string | null>(null);
  async function save() {
    const s = (edit || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    if (!s || s === slug) { setEdit(null); return; }
    const { data, error } = await supabase.from('workspaces').update({ slug: s }).eq('id', ws.id).select('slug').maybeSingle();
    if (error || !data) { toast(error?.message?.includes('duplicate') ? 'That address is taken. Try another.' : 'Only owners can change the address.'); return; }
    onChange(data.slug); setEdit(null); toast('Address changed. Old portal links stop working.');
  }
  return (
    <div className="brand-address">
      <span className="tip">Brand address:</span>
      {edit === null ? <><code>{origin.replace(/^https?:\/\//, '')}/p/{slug}</code>{ws.role === 'owner' && <button type="button" className="linkish" onClick={() => setEdit(slug)}>Change</button>}</>
        : <form onSubmit={(e) => { e.preventDefault(); save(); }}><input className="in mono" autoFocus value={edit} maxLength={40} onChange={(e) => setEdit(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setEdit(null)} /><button className="btn" type="submit">Save</button></form>}
    </div>
  );
}

function PortalEditor({ free = false, portal, wsSlug, origin, folders, collections, items, events, toast, onBack, onSaved, onDelete }: {
  free?: boolean;
  portal: Portal; wsSlug: string; origin: string;
  folders: { id: string; name: string }[]; collections: { id: string; name: string }[]; items: Asset[]; events: Ev[];
  toast: (m: string) => void; onBack: () => void; onSaved: (p: Portal) => void; onDelete: () => void;
}) {
  const [f, setF] = useState(() => ({
    name: portal.name, slug: portal.slug, intro: portal.intro || '', include_all: portal.include_all, folder_ids: portal.folder_ids || [], collection_ids: portal.collection_ids || [],
    show_guidelines: portal.show_guidelines, access: portal.access, allowlist: (portal.allowlist || []).join('\n'), passcode: '', allow_download: portal.allow_download, formats: portal.formats || ['original'], published: portal.published,
  }));
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const set = (k: string, v: any) => setF((x) => ({ ...x, [k]: v }));
  const toggle = (k: 'folder_ids' | 'collection_ids' | 'formats', id: string) => setF((x) => ({ ...x, [k]: (x[k] as string[]).includes(id) ? (x[k] as string[]).filter((y) => y !== id) : [...(x[k] as string[]), id] }));
  const url = `${origin}/p/${wsSlug}/${portal.slug}`;
  const hasPass = !!portal.passcode_hash;

  async function save(e?: React.FormEvent) {
    e?.preventDefault();
    if (f.access === 'passcode' && !hasPass && f.passcode.trim().length < 4) { toast('Set a passcode of at least 4 characters.'); return; }
    setBusy(true);
    const { passcode, ...rest } = f;
    const body: any = { id: portal.id, ...rest, allowlist: f.allowlist };
    if (passcode.trim()) body.passcode = passcode.trim();
    const r = await fetch('/api/portals', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    setBusy(false);
    if (j?.code === 'upgrade') { openUpgrade({ reason: 'portal' }); return; }
    if (!r?.ok || !j?.portal) { toast(j?.error || 'Couldn’t save.'); return; }
    onSaved({ ...j.portal, passcode_hash: j.portal.has_passcode ? 'set' : null });
    set('passcode', '');
    setF((x) => ({ ...x, slug: j.portal.slug, allowlist: (j.portal.allowlist || []).join('\n') }));
    toast('Portal saved');
  }

  // Analytics: last 30 days.
  const names = useMemo(() => new Map(items.map((i) => [i.id, i.name])), [items]);
  const views = events.filter((e) => e.event === 'view').length;
  const dls = events.filter((e) => e.event === 'download');
  const top = Object.entries(dls.reduce((m: Record<string, number>, e) => { if (e.asset_id) m[e.asset_id] = (m[e.asset_id] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const people = Object.entries(dls.reduce((m: Record<string, number>, e) => { if (e.email) m[e.email] = (m[e.email] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 8);

  return (
    <div className="portal-editor">
      <div className="pe-head">
        <button className="ghost" type="button" onClick={onBack}><Icon.Back />Portals</button>
        <span className="spacer" />
        <a className="btn" href={url} target="_blank" rel="noreferrer">{free ? 'Preview' : 'Open portal'}</a>
        {free
          ? <button className="primary" type="button" onClick={() => openUpgrade({ reason: 'portal' })}>Publish to share</button>
          : <button className="primary" type="button" onClick={async () => { try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { toast(url); } }}>Copy link</button>}
      </div>
      <div className="pe-cols">
        <form className="settings" onSubmit={save}>
          <h2>{portal.name}</h2>
          <p className="tip"><code>{url.replace(/^https?:\/\//, '')}</code>. Styled from your brand kit: change the kit and the portal follows.</p>
          <div className="bf"><div className="bl"><label htmlFor="pn">Name</label></div><input id="pn" className="in" value={f.name} maxLength={80} onChange={(e) => set('name', e.target.value)} /></div>
          <div className="bf"><div className="bl"><label htmlFor="ps">Address</label></div><div className="slugrow"><span className="tip">/p/{wsSlug}/</span><input id="ps" className="in mono" value={f.slug} maxLength={40} onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} /></div></div>
          <div className="bf"><div className="bl"><label htmlFor="pi">Intro <span className="opt">optional</span></label></div><textarea id="pi" className="in" rows={2} maxLength={1000} value={f.intro} placeholder="e.g. Approved images for press. Please credit Oakhaus." onChange={(e) => set('intro', e.target.value)} /></div>

          <h3>What’s in it</h3>
          <label className="toggle"><input type="checkbox" checked={f.include_all} onChange={(e) => set('include_all', e.target.checked)} /> Everything approved (grouped by folder)</label>
          {!f.include_all && (
            <div className="pick">
              {folders.length > 0 && <div><div className="label">Folders</div>{folders.map((x) => <label key={x.id} className="toggle"><input type="checkbox" checked={f.folder_ids.includes(x.id)} onChange={() => toggle('folder_ids', x.id)} /> {x.name}</label>)}</div>}
              {collections.length > 0 && <div><div className="label">Smart collections</div>{collections.map((x) => <label key={x.id} className="toggle"><input type="checkbox" checked={f.collection_ids.includes(x.id)} onChange={() => toggle('collection_ids', x.id)} /> {x.name}</label>)}</div>}
              {!folders.length && !collections.length && <p className="tip">Make folders or smart collections in Assets to choose what goes in.</p>}
            </div>
          )}
          {f.include_all && collections.length > 0 && <div className="pick"><div><div className="label">Also show these collections as sections</div>{collections.map((x) => <label key={x.id} className="toggle"><input type="checkbox" checked={f.collection_ids.includes(x.id)} onChange={() => toggle('collection_ids', x.id)} /> {x.name}</label>)}</div></div>}
          <label className="toggle"><input type="checkbox" checked={f.show_guidelines} onChange={(e) => set('show_guidelines', e.target.checked)} /> Brand guidelines page (logos, colours, fonts, imagery do’s and don’ts)</label>
          <p className="tip">Drafts are never shown.</p>

          <h3>Who can open it</h3>
          <div className="seg" role="group" aria-label="Access">
            {([['public', 'Anyone with the link'], ['passcode', 'Passcode'], ['allowlist', 'Invite list']] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={f.access === k} onClick={() => set('access', k)}>{l}</button>)}
          </div>
          {f.access === 'passcode' && <input className="in" type="text" autoComplete="off" value={f.passcode} placeholder={hasPass ? 'Passcode set. Type a new one to change it' : 'Choose a passcode (at least 4 characters)'} onChange={(e) => set('passcode', e.target.value)} />}
          {f.access === 'allowlist' && <>
            <textarea className="in mono" rows={4} value={f.allowlist} placeholder={'jo@agency.com\n@retailer.com  (everyone at a domain)'} onChange={(e) => set('allowlist', e.target.value)} />
            <p className="tip">Visitors sign in with a link sent to their email. You’ll see who downloaded what.</p>
          </>}

          <h3>Downloads</h3>
          <label className="toggle"><input type="checkbox" checked={f.allow_download} onChange={(e) => set('allow_download', e.target.checked)} /> Allow downloads</label>
          {f.allow_download && <div className="chips">{FORMATS.map(([k, l]) => <button key={k} type="button" className="chip" aria-pressed={f.formats.includes(k)} onClick={() => toggle('formats', k)}>{l}</button>)}</div>}

          <h3>Status</h3>
          {free ? (
            <div className="portal-locked">
              <p className="tip"><b>Not published yet.</b> Your team can preview it now. Publish it to share it with agencies, retailers and partners.</p>
              <button className="primary" type="button" onClick={() => openUpgrade({ reason: 'portal' })}>Publish portal</button>
            </div>
          ) : (
            <label className="toggle"><input type="checkbox" checked={f.published} onChange={(e) => set('published', e.target.checked)} /> Published (turn off to hide it without deleting)</label>
          )}

          <div className="actions">
            {confirmDel ? <><span className="tip">Delete this portal?</span><button className="btn" type="button" onClick={onDelete}>Delete</button><button className="btn quiet" type="button" onClick={() => setConfirmDel(false)}>Keep</button></>
              : <button className="btn quiet" type="button" onClick={() => setConfirmDel(true)}>Delete portal</button>}
            <span className="spacer" />
            <button className="primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </form>

        <aside className="pe-stats">
          <div className="label">Last 30 days</div>
          <div className="statrow"><div><b>{views}</b><span>visits</span></div><div><b>{dls.length}</b><span>downloads</span></div></div>
          <div className="label">Top downloads</div>
          {top.length ? <ol className="toplist">{top.map(([id, n]) => <li key={id}><span>{names.get(id) || 'Removed file'}</span><b>{n}</b></li>)}</ol> : <p className="tip">No downloads yet.</p>}
          {portal.access === 'allowlist' && <>
            <div className="label">Who downloaded</div>
            {people.length ? <ol className="toplist">{people.map(([em, n]) => <li key={em}><span>{em}</span><b>{n}</b></li>)}</ol> : <p className="tip">Nobody yet.</p>}
          </>}
        </aside>
      </div>
    </div>
  );
}

function Links({ shares, origin, items, folders, collections, toast, onChanged, onDelete }: {
  shares: Share[]; origin: string; items: Asset[]; folders: { id: string; name: string }[]; collections: { id: string; name: string }[];
  toast: (m: string) => void; onChanged: () => void; onDelete: (id: string) => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? shares : shares.filter(live);
  const what = (s: Share) => s.kind === 'folder' ? `Folder: ${folders.find((f) => f.id === s.folder_id)?.name || 'deleted'}` : s.kind === 'collection' ? `Collection: ${collections.find((c) => c.id === s.collection_id)?.name || 'deleted'}` : s.asset_ids?.length === 1 ? (items.find((i) => i.id === s.asset_ids[0])?.name || '1 file') : `${s.asset_ids?.length || 0} files`;
  async function patch(id: string, body: any, msg: string) {
    const r = await fetch('/api/shares', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, ...body }) }).catch(() => null);
    if (!r?.ok) { toast('Couldn’t change it.'); return; }
    toast(msg); onChanged();
  }
  if (!shares.length) return <div className="portal-empty"><h2>No links yet</h2><p className="tip">Share a file from its page, or a folder or smart collection from the top of Assets. Select several files to share them together. Every link shows up here with its views and downloads.</p></div>;
  return (
    <div className="links">
      <div className="links-bar"><span className="tip">{shown.length} {all ? '' : 'live '}link{shown.length === 1 ? '' : 's'}</span><span className="spacer" /><label className="toggle"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show expired and turned off</label></div>
      <div className="links-table" role="table">
        <div className="lt-row lt-h" role="row"><span>Link</span><span>Shares</span><span>Expires</span><span>Views</span><span>Downloads</span><span /></div>
        {shown.map((s) => {
          const url = `${origin}/s/${s.token}`;
          const state = s.revoked_at ? 'Turned off' : s.expires_at && new Date(s.expires_at) < new Date() ? 'Expired' : null;
          return (
            <div key={s.id} className={'lt-row' + (state ? ' dead' : '')} role="row">
              <span className="lt-title"><b>{s.title}</b><small>{day(s.created_at)}{s.passcode_hash ? ' · passcode' : ''}{!s.allow_download ? ' · view only' : ''}{state ? ` · ${state}` : ''}</small></span>
              <span>{what(s)}</span>
              <span>{s.expires_at ? day(s.expires_at) : 'Never'}</span>
              <span className="num">{s.views}</span>
              <span className="num">{s.downloads}</span>
              <span className="lt-act">
                {!state && <button type="button" className="btn quiet" onClick={async () => { try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { toast(url); } }}>Copy</button>}
                {!state && <a className="btn quiet" href={url} target="_blank" rel="noreferrer">Open</a>}
                {s.revoked_at ? <button type="button" className="btn quiet" onClick={() => patch(s.id, { restore: true }, 'Link turned back on')}>Turn on</button>
                  : <button type="button" className="btn quiet" onClick={() => patch(s.id, { revoke: true }, 'Link turned off. It stops working straight away.')}>Turn off</button>}
                {state && <button type="button" className="btn quiet" onClick={() => onDelete(s.id)}>Delete</button>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
