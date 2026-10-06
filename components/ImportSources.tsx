'use client';
import { openUpgrade } from './Billing';
import { useCallback, useEffect, useState } from 'react';
import { Icon } from './icons';

// Bring images in from where a team already keeps them: Google Drive, Dropbox, Box.
// Each source only appears switched on when its keys are set on the server.

type Config = {
  dropbox: { appKey: string } | null;
  google: { clientId: string; apiKey: string; appId: string } | null;
  box: { connected: boolean; account?: string | null } | null;
};
type Progress = { source: string; total: number; done: number; added: number; skipped: number; failed: number; to?: string } | null;

declare global { interface Window { Dropbox?: any; gapi?: any; google?: any } }

function loadScript(src: string, attrs: Record<string, string> = {}) {
  return new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src; s.async = true;
    for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
    s.onload = () => resolve(); s.onerror = () => reject(new Error(`Couldn’t load ${src}`));
    document.head.appendChild(s);
  });
}

export default function ImportSources({ ws, folderId, folderName, onDone, toast, startBox }: {
  ws: string;
  folderId: string | null;
  folderName?: string | null;
  onDone: (folderId?: string | null) => void;
  toast: (m: string) => void;
  startBox?: boolean; // just came back from connecting Box: open its browser
}) {
  const [cfg, setCfg] = useState<Config | null>(null);
  const [progress, setProgress] = useState<Progress>(null);
  const [boxOpen, setBoxOpen] = useState(!!startBox);

  useEffect(() => { fetch('/api/import/config').then((r) => r.json()).then(setCfg).catch(() => setCfg({ dropbox: null, google: null, box: null })); }, []);

  // Send files to the server in small batches and show progress as they land.
  const run = useCallback(async (source: string, endpoint: string, files: any[], extra: Record<string, any> = {}) => {
    if (!files.length) return;
    const p = { source, total: files.length, done: 0, added: 0, skipped: 0, failed: 0, to: extra.folder_name || folderName || undefined };
    setProgress({ ...p });
    let landed: string | null | undefined = undefined;
    let held = 0; // Free's 50 files reached: stop and offer the trial
    for (let i = 0; i < files.length; i += 6) {
      if (held) { held += Math.min(6, files.length - i); continue; }
      const res = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace_id: ws, folder_id: folderId, ...extra, files: files.slice(i, i + 6) }) }).catch(() => null);
      const json = res ? await res.json().catch(() => null) : null;
      if (!res?.ok || !json) { p.failed += Math.min(6, files.length - i); }
      else {
        if (json.folder_id !== undefined) landed = json.folder_id;
        for (const r of json.results || []) { if (r.skipped) p.skipped++; else if (r.id) p.added++; else if (/FREE_FILE_LIMIT/.test(r.error || '')) held++; else p.failed++; }
      }
      p.done = Math.min(files.length, i + 6);
      setProgress({ ...p });
    }
    toast(`${p.added} added from ${source}${p.skipped ? `, ${p.skipped} already here` : ''}${p.failed ? `, ${p.failed} couldn’t be copied` : ''}`);
    if (held) openUpgrade({ reason: 'files', count: held });
    setTimeout(() => setProgress(null), 1500);
    onDone(landed);
  }, [ws, folderId, folderName, onDone, toast]);

  async function dropbox() {
    if (!cfg?.dropbox) return;
    try {
      await loadScript('https://www.dropbox.com/static/api/2/dropins.js', { id: 'dropboxjs', 'data-app-key': cfg.dropbox.appKey });
      window.Dropbox.choose({
        linkType: 'direct', multiselect: true, extensions: ['images', 'video'],
        success: (files: any[]) => run('Dropbox', '/api/import/dropbox', files.map((f) => ({ id: f.id, name: f.name, link: f.link }))),
      });
    } catch { toast('Dropbox didn’t load. Check the app key and allowed domain.'); }
  }

  async function google() {
    const g = cfg?.google;
    if (!g) return;
    try {
      await Promise.all([loadScript('https://apis.google.com/js/api.js'), loadScript('https://accounts.google.com/gsi/client')]);
      await new Promise<void>((r) => window.gapi.load('picker', () => r()));
      const token: string = await new Promise((resolve, reject) => {
        const client = window.google.accounts.oauth2.initTokenClient({
          client_id: g.clientId, scope: 'https://www.googleapis.com/auth/drive.file',
          callback: (t: any) => (t?.access_token ? resolve(t.access_token) : reject(new Error('cancelled'))),
          error_callback: () => reject(new Error('cancelled')),
        });
        client.requestAccessToken({ prompt: '' });
      });
      const P = window.google.picker;
      const view = new P.DocsView(P.ViewId.DOCS_IMAGES_AND_VIDEOS).setIncludeFolders(true).setMode(P.DocsViewMode.GRID);
      const builder = new P.PickerBuilder()
        .addView(view)
        .enableFeature(P.Feature.MULTISELECT_ENABLED)
        .enableFeature(P.Feature.SUPPORT_DRIVES)
        .setOAuthToken(token).setDeveloperKey(g.apiKey)
        .setTitle('Choose images and videos to bring into Mise')
        .setCallback((data: any) => {
          if (data.action !== P.Action.PICKED) return;
          run('Google Drive', '/api/import/google', (data.docs || []).map((d: any) => ({ id: d.id, name: d.name, mimeType: d.mimeType })), { token });
        });
      if (g.appId) builder.setAppId(g.appId);
      builder.build().setVisible(true);
    } catch (e: any) { if (e?.message !== 'cancelled') toast('Google Drive didn’t load. Check the Google keys.'); }
  }

  function box() {
    if (!cfg?.box) return;
    if (!cfg.box.connected) { location.href = '/api/connect/box'; return; }
    setBoxOpen(true);
  }

  const sources = [
    { id: 'google', name: 'Google Drive', icon: <Icon.Drive />, on: !!cfg?.google, act: google, note: 'Pick images and videos' },
    { id: 'dropbox', name: 'Dropbox', icon: <Icon.Dropbox />, on: !!cfg?.dropbox, act: dropbox, note: 'Pick images and videos' },
    { id: 'box', name: 'Box', icon: <Icon.Box />, on: !!cfg?.box, act: box, note: cfg?.box?.connected ? `Connected${cfg.box.account ? ` as ${cfg.box.account}` : ''} · files or whole folders` : 'Connect, then pick files or whole folders' },
  ];

  return (
    <div className="imp">
      <div className="imp-list">
        {sources.map((s) => (
          <button key={s.id} type="button" className="src" disabled={!cfg || !s.on || !!progress} onClick={s.act}>
            {s.icon}<span><b>{s.name}{cfg && !s.on && <em className="soon">Soon</em>}</b><small>{s.on ? s.note : 'Not switched on yet. Upload a folder from your computer for now.'}</small></span>
          </button>
        ))}
      </div>
      <p className="tip">Files are copied into Mise{folderName ? <> and land in <b>{folderName}</b></> : ''}. Anything already imported is skipped. Box folders keep their name.</p>
      {progress && (
        <div className="imp-prog" role="status">
          <div className="bar"><i style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>
          <span>Copying from {progress.source}… {progress.done} of {progress.total}{progress.to ? ` into ${progress.to}` : ''}</span>
        </div>
      )}
      {boxOpen && cfg?.box?.connected && <BoxBrowser onClose={() => setBoxOpen(false)} onImport={(files, name) => { setBoxOpen(false); run('Box', '/api/import/box', files, name ? { folder_name: name } : {}); }} toast={toast}
        onDisconnect={async () => { await fetch('/api/connect/box', { method: 'DELETE' }); setCfg((c) => (c ? { ...c, box: { connected: false } } : c)); setBoxOpen(false); toast('Box disconnected'); }} />}
    </div>
  );
}

type BoxItem = { type: 'file' | 'folder'; id: string; name: string; size?: number };

function BoxBrowser({ onClose, onImport, onDisconnect, toast }: { onClose: () => void; onImport: (files: any[], folderName?: string) => void; onDisconnect: () => void; toast: (m: string) => void }) {
  const [folder, setFolder] = useState('0');
  const [data, setData] = useState<{ folder: { id: string; name: string; path: { id: string; name: string }[] }; items: BoxItem[] } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setData(null); setPicked(new Set());
    fetch(`/api/import/box/browse?folder=${folder}`).then((r) => r.json()).then((j) => { if (j.error) toast(j.error === 'not_connected' ? 'Box needs connecting again.' : j.error); else setData(j); }).catch(() => toast('Box didn’t respond.'));
  }, [folder, toast]);

  const files = (data?.items || []).filter((i) => i.type === 'file');
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  async function importFolder(id: string, name: string) {
    setBusy(true);
    const j = await fetch(`/api/import/box/browse?folder=${id}&all=1`).then((r) => r.json()).catch(() => null);
    setBusy(false);
    if (!j?.files?.length) { toast(j?.error || 'No images or videos in that folder.'); return; }
    onImport(j.files.map((f: any) => ({ id: f.id, name: f.name, path: f.path })), name);
  }

  return (
    <div className="boxb" role="dialog" aria-label="Choose from Box">
      <div className="boxb-head">
        <b>Box</b>
        <nav className="boxb-path">
          {[...(data?.folder.path || []), ...(data && data.folder.id !== '0' ? [{ id: data.folder.id, name: data.folder.name }] : [])].map((p, i, a) => (
            <span key={p.id}>{i > 0 && ' / '}{i < a.length - 1 ? <button type="button" className="linkish" onClick={() => setFolder(p.id)}>{p.name}</button> : <b>{p.name}</b>}</span>
          ))}
          {data?.folder.id === '0' && <b>All files</b>}
        </nav>
        <span className="spacer" />
        <button type="button" className="btn quiet" onClick={onDisconnect}>Disconnect</button>
        <button type="button" className="x" aria-label="Close" onClick={onClose}><Icon.Close /></button>
      </div>
      <div className="boxb-list">
        {!data ? <p className="tip">Loading…</p> : !data.items.length ? <p className="tip">No folders, images or videos here.</p> : data.items.map((it) => (
          it.type === 'folder' ? (
            <div key={it.id} className="boxb-row">
              <button type="button" className="boxb-open" onClick={() => setFolder(it.id)}><Icon.Folder size={17} />{it.name}</button>
              <button type="button" className="btn quiet" disabled={busy} onClick={() => importFolder(it.id, it.name)}>Import folder</button>
            </div>
          ) : (
            <label key={it.id} className="boxb-row">
              <input type="checkbox" checked={picked.has(it.id)} onChange={() => toggle(it.id)} />
              <span className="boxb-name">{it.name}</span>
              <small>{it.size ? `${Math.round(it.size / 1024)} KB` : ''}</small>
            </label>
          )
        ))}
      </div>
      <div className="boxb-foot">
        {files.length > 0 && <button type="button" className="linkish" onClick={() => setPicked(picked.size === files.length ? new Set() : new Set(files.map((f) => f.id)))}>{picked.size === files.length ? 'Clear' : 'Select all'}</button>}
        <span className="spacer" />
        {data && data.folder.id !== '0' && <button type="button" className="btn" disabled={busy} onClick={() => importFolder(data.folder.id, data.folder.name)}>{busy ? 'Finding files…' : `Import “${data.folder.name}”`}</button>}
        <button type="button" className="primary" disabled={!picked.size} onClick={() => onImport(files.filter((f) => picked.has(f.id)).map((f) => ({ id: f.id, name: f.name })))}>Import {picked.size || ''} selected</button>
      </div>
    </div>
  );
}
