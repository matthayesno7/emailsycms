'use client';
import { useEffect, useState } from 'react';
import type { Asset } from './Library';
import { LIFECYCLE, lifecycleOf, lifecyclePatch, type Lifecycle } from '@/lib/lifecycle';

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
const dateInput = (iso?: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');

// The asset editor's "Availability" panel: retire a file (archive), record its licence end date,
// or mark it obsolete and point to its replacement. Unavailable files stay in the library, marked,
// and are kept out of Studio, share links, portals and Claude.
// Free brands can archive; licence dates and replacements are on Pro.
export default function AssetLifecycle({ it, pro, replacements, onPatch, onOpenAsset, onUpgrade, toast }: {
  it: Asset;
  pro: boolean;
  replacements: { id: string; name: string }[];   // same-kind files still available
  onPatch: (p: Record<string, any>) => Promise<boolean>;
  onOpenAsset?: (id: string) => void;
  onUpgrade?: (reason?: 'edit' | 'lifecycle') => void;
  toast: (m: string) => void;
}) {
  const state = lifecycleOf(it);
  const [mode, setMode] = useState<null | 'archived' | 'obsolete'>(null);
  const [reason, setReason] = useState('');
  const [replace, setReplace] = useState<string>(it.replaced_by || '');
  const [licence, setLicence] = useState(dateInput(it.licence_expires_at));
  useEffect(() => { setLicence(dateInput(it.licence_expires_at)); setReplace(it.replaced_by || ''); }, [it.licence_expires_at, it.replaced_by]);
  const replacement = it.replaced_by ? replacements.find((r) => r.id === it.replaced_by) || { id: it.replaced_by, name: 'its replacement' } : null;

  async function retire(to: 'archived' | 'obsolete') {
    const ok = await onPatch({ ...lifecyclePatch(to, reason), replaced_by: to === 'obsolete' && replace ? replace : null });
    if (ok) { toast(to === 'archived' ? 'Archived. Find it under “No longer available”.' : 'Marked obsolete'); setMode(null); setReason(''); }
  }
  async function restore() {
    // A file whose licence has passed can only come back with a new licence date.
    const lapsed = it.licence_expires_at && Date.parse(it.licence_expires_at) <= Date.now();
    if (await onPatch({ ...lifecyclePatch('active'), replaced_by: null, ...(lapsed ? { licence_expires_at: null } : {}) })) toast(lapsed ? 'Available again. Its old licence date was cleared; add the new one.' : 'Available again');
  }
  async function saveLicence(v: string) {
    setLicence(v);
    const iso = v ? new Date(v + 'T23:59:59').toISOString() : null;
    if (iso === (it.licence_expires_at || null)) return;
    const past = iso && Date.parse(iso) <= Date.now();
    const patch: Record<string, any> = { licence_expires_at: iso };
    if (past) Object.assign(patch, lifecyclePatch('expired', 'Licence expired'));
    else if (state === 'expired' && iso) Object.assign(patch, lifecyclePatch('active')); // renewed
    if (await onPatch(patch)) toast(!iso ? 'Licence date removed' : past ? 'Licence date is in the past, so it’s now expired' : `Licence runs until ${day(iso)}`);
  }

  if (state !== 'active') {
    return (
      <div className="ed-sec">
        <div className="label">Availability</div>
        <div className="life-box off">
          <div className="life-state"><b>{LIFECYCLE[state].label}</b>
            <button className="btn" type="button" onClick={restore}>{state === 'expired' ? 'Renew' : 'Make available'}</button>
          </div>
          <p className="tip">{it.lifecycle_reason && it.lifecycle_reason !== LIFECYCLE[state].label ? `“${it.lifecycle_reason}” · ` : ''}{it.lifecycle_at ? `since ${day(it.lifecycle_at)}` : ''}</p>
          <p className="tip">{LIFECYCLE[state].help}</p>
          {replacement && <p className="tip">Use instead: <button type="button" className="linkish" onClick={() => onOpenAsset?.(replacement.id)}>{replacement.name}</button></p>}
          {state === 'expired' && pro && (
            <div className="row-inline"><label htmlFor="lic2" className="tip">New licence end</label>
              <input id="lic2" className="in short" type="date" value={licence && Date.parse(licence) > Date.now() ? licence : ''} min={new Date(Date.now() + 864e5).toISOString().slice(0, 10)} onChange={(e) => saveLicence(e.target.value)} />
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="ed-sec">
      <div className="label">Availability</div>
      <div className="life-box">
        <div className="bf">
          <div className="bl"><label htmlFor="lic">Licence ends{!pro && <span className="pro-pill">Pro</span>}</label></div>
          {pro ? (
            <div className="row-inline">
              <input id="lic" className="in short" type="date" value={licence} onChange={(e) => saveLicence(e.target.value)} />
              {licence && <button type="button" className="linkish" onClick={() => saveLicence('')}>Remove</button>}
            </div>
          ) : (
            <p className="tip">Add the date a photo’s licence or usage rights run out, and Mise blocks it automatically on that day. <button type="button" className="linkish" onClick={() => onUpgrade?.('lifecycle')}>See Pro</button></p>
          )}
          {pro && <p className="tip">{licence ? 'On that day it stops being downloadable, shareable and usable in new work.' : 'For stock or licensed photos: on this date it stops being downloadable and shareable.'}</p>}
        </div>

        {mode ? (
          <div className="bf">
            <div className="bl"><label htmlFor="why">{mode === 'archived' ? 'Why archive it? (optional)' : 'Why is it obsolete? (optional)'}</label></div>
            <input id="why" className="in" maxLength={300} placeholder={mode === 'archived' ? 'e.g. Old campaign' : 'e.g. Replaced by the 2026 logo'} value={reason} onChange={(e) => setReason(e.target.value)} />
            {mode === 'obsolete' && (
              <>
                <div className="bl"><label htmlFor="rep">Use instead</label></div>
                <select id="rep" className="in" value={replace} onChange={(e) => setReplace(e.target.value)}>
                  <option value="">Nothing yet</option>
                  {replacements.filter((r) => r.id !== it.id).slice(0, 500).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </>
            )}
            <div className="row-inline">
              <button className="primary" type="button" onClick={() => retire(mode)}>{mode === 'archived' ? 'Archive' : 'Mark obsolete'}</button>
              <button className="btn quiet" type="button" onClick={() => setMode(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <div className="row-inline">
            <button className="btn" type="button" onClick={() => setMode('archived')}>Archive</button>
            {pro ? <button className="btn" type="button" onClick={() => setMode('obsolete')}>Mark obsolete…</button>
              : <button className="btn quiet" type="button" onClick={() => onUpgrade?.('lifecycle')} title="On Pro">Mark obsolete<span className="pro-pill">Pro</span></button>}
          </div>
        )}
      </div>
    </div>
  );
}
