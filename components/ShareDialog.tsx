'use client';
import { useState } from 'react';

export type ShareTarget = { kind: 'assets'; asset_ids: string[]; title: string } | { kind: 'folder'; folder_id: string; title: string } | { kind: 'collection'; collection_id: string; title: string };
const EXPIRY: [string, string][] = [['never', 'Never'], ['7', '7 days'], ['30', '30 days'], ['custom', 'Pick a date']];
const FORMATS: [string, string, string][] = [['original', 'Original', 'Full size, as uploaded'], ['web', 'Web', 'Up to 2000px'], ['email', 'Email-ready', '1200px, compressed']];

// Create a share link: one or more files, a folder or a smart collection.
export default function ShareDialog({ ws, target, toast, onClose, onCreated }: {
  ws: string;
  target: ShareTarget;
  toast: (m: string) => void;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const [title, setTitle] = useState(target.title);
  const [message, setMessage] = useState('');
  const [expiry, setExpiry] = useState('30');
  const [date, setDate] = useState(() => new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10));
  const [passcode, setPasscode] = useState('');
  const [usePass, setUsePass] = useState(false);
  const [download, setDownload] = useState(true);
  const [formats, setFormats] = useState<string[]>(['original', 'web', 'email']);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  const what = target.kind === 'assets' ? `${target.asset_ids.length} file${target.asset_ids.length === 1 ? '' : 's'}` : target.kind === 'folder' ? 'This folder (new files show up too)' : 'This smart collection (it keeps filling itself)';

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (usePass && passcode.trim().length < 4) { toast('Use a passcode of at least 4 characters.'); return; }
    setBusy(true);
    const expires_at = expiry === 'never' ? null : expiry === 'custom' ? new Date(date + 'T23:59:59').toISOString() : new Date(Date.now() + Number(expiry) * 864e5).toISOString();
    const r = await fetch('/api/shares', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace_id: ws, ...target, title, message, expires_at, passcode: usePass ? passcode.trim() : null, allow_download: download, formats }) }).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    setBusy(false);
    if (!r?.ok || !j?.share) { toast(j?.error || 'Couldn’t create the link. Try again.'); return; }
    const url = `${location.origin}/s/${j.share.token}`;
    setLink(url);
    try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch {}
    onCreated?.();
  }

  if (link) return (
    <div className="settings sharedlg">
      <h2>Link ready</h2>
      <p className="tip">{what}, shared as “{title}”.{usePass ? ' Send the passcode separately.' : ''}</p>
      <div className="linkbox"><input className="in mono" readOnly value={link} onFocus={(e) => e.target.select()} /><button className="primary" type="button" onClick={async () => { try { await navigator.clipboard.writeText(link); toast('Copied'); } catch {} }}>Copy</button></div>
      <div className="actions"><a className="btn" href={link} target="_blank" rel="noreferrer">Open it</a><span className="spacer" /><button className="btn" type="button" onClick={onClose}>Done</button></div>
      <p className="tip">See views and downloads, or turn it off, in Sharing → Links.</p>
    </div>
  );

  return (
    <form className="settings sharedlg" onSubmit={create}>
      <h2>Share a link</h2>
      <p className="tip">{what}. Anyone with the link can see it, styled with your brand kit.</p>
      <div className="bf"><div className="bl"><label htmlFor="sh-title">Title</label></div><input id="sh-title" className="in" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></div>
      <div className="bf"><div className="bl"><label htmlFor="sh-msg">Message <span className="opt">optional</span></label></div><textarea id="sh-msg" className="in" rows={2} maxLength={1000} value={message} placeholder="e.g. Final images for the autumn campaign" onChange={(e) => setMessage(e.target.value)} /></div>
      <div className="bf"><div className="bl"><span>Expires</span></div>
        <div className="seg" role="group" aria-label="Expires">{EXPIRY.map(([k, l]) => <button key={k} type="button" aria-pressed={expiry === k} onClick={() => setExpiry(k)}>{l}</button>)}</div>
        {expiry === 'custom' && <input className="in" type="date" value={date} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} />}
      </div>
      <div className="bf"><label className="toggle"><input type="checkbox" checked={usePass} onChange={(e) => setUsePass(e.target.checked)} /> Require a passcode</label>
        {usePass && <input className="in" type="text" autoComplete="off" value={passcode} placeholder="At least 4 characters" onChange={(e) => setPasscode(e.target.value)} />}
      </div>
      <div className="bf"><label className="toggle"><input type="checkbox" checked={download} onChange={(e) => setDownload(e.target.checked)} /> Allow downloads</label>
        {download && <div className="fmtrow">{FORMATS.map(([k, l, d]) => (
          <label key={k} className="fmt"><input type="checkbox" checked={formats.includes(k)} onChange={(e) => setFormats((f) => (e.target.checked ? [...f, k] : f.filter((x) => x !== k)))} /><span><b>{l}</b><small>{d}</small></span></label>
        ))}</div>}
      </div>
      <div className="actions"><span className="spacer" /><button className="btn" type="button" onClick={onClose}>Cancel</button><button className="primary" type="submit" disabled={busy || (download && !formats.length)}>{busy ? 'Creating…' : 'Create link'}</button></div>
    </form>
  );
}
