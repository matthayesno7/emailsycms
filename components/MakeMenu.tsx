'use client';
import { useEffect, useState } from 'react';
import { ACTIONS, actionDesigns, SOCIAL_SIZES, type ActionDef } from '@/lib/actions';
import { can } from '@/lib/roles';
import { modelName } from '@/lib/models';
import { openUpgrade } from './Billing';
import { Icon } from './icons';

// "Make…": start from a picture you already have. Opened from a file's page or from the selection bar.
type Src = { id: string; name: string; thumb: string | null };
type Result = { source: { id: string; name: string }; assets: { id: string; name: string; url: string | null; width: number | null; height: number | null; status: string }[]; error?: string };

export default function MakeMenu({ wsId, role, plan, assets, onClose, onOpen, toast }: {
  wsId: string; role: string | null | undefined; plan: string; assets: Src[];
  onClose: () => void; onOpen: (id: string) => void; toast: (m: string) => void;
}) {
  const [act, setAct] = useState<ActionDef | null>(null);
  const [choice, setChoice] = useState('');
  const [detail, setDetail] = useState('');
  const [sizes, setSizes] = useState<string[]>(SOCIAL_SIZES.map((s) => s.id));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<{ results: Result[]; model?: string; designs: number; job?: string } | null>(null);
  const [clip, setClip] = useState<{ id: string; name: string; url: string | null } | null>(null);
  const n = assets.length;
  const free = plan === 'free';
  const actions = ACTIONS.filter((a) => (a.kind === 'resize' ? can.manage(role) : can.add(role)));

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [busy, onClose]);

  // A clip saves itself in a minute or two: check every 8 seconds while this is open.
  useEffect(() => {
    if (!done?.job || clip) return;
    const t = setInterval(() => {
      fetch(`/api/make/video?workspace_id=${wsId}&job=${encodeURIComponent(done.job!)}`).then((r) => r.json()).then((j) => { if (j.ready) setClip(j.asset); }).catch(() => {});
    }, 8000);
    return () => clearInterval(t);
  }, [done?.job, clip, wsId]);

  function pick(a: ActionDef) {
    if (free) { onClose(); openUpgrade({ reason: a.kind === 'resize' ? 'edit' : 'media' }); return; }
    setAct(a); setChoice(''); setDetail(''); setErr(''); setDone(null); setClip(null);
  }

  async function make() {
    if (!act) return;
    setBusy(true); setErr('');
    const r = await fetch('/api/make/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace_id: wsId, action: act.id, asset_ids: assets.map((a) => a.id), choice, detail, sizes }) }).catch(() => null);
    const j = await r?.json().catch(() => null);
    setBusy(false);
    if (j?.code === 'upgrade') { onClose(); openUpgrade({ reason: act.kind === 'resize' ? 'edit' : 'media' }); return; }
    if (!r?.ok || !j) { setErr(j?.error || 'Couldn’t make that. Try again.'); return; }
    setDone(j);
    const made = (j.results as Result[]).reduce((s, x) => s + x.assets.length, 0);
    if (act.kind !== 'video') toast(made ? `${made} new ${made === 1 ? 'file' : 'files'} ${act.kind === 'resize' ? 'saved' : 'in Review'}` : 'Nothing came back. Try another option.');
  }

  const cost = act ? actionDesigns(act) * (act.batch ? n : 1) : 0;
  const ready = act && (act.kind === 'resize' ? sizes.length > 0 : !!choice || (!!act.ask && !!detail.trim()));
  const titleFor = n === 1 ? `“${assets[0].name}”` : `${n} images`;

  return (
    <>
      <div className="scrim top" onClick={() => !busy && onClose()} />
      <div className="modal top wide mm" role="dialog" aria-modal="true" aria-label={`Make from ${titleFor}`}>
        <button className="x" type="button" aria-label="Close" onClick={onClose} disabled={busy}><Icon.Close /></button>
        <div className="mm-head">
          <div className="mm-thumbs">{assets.slice(0, 4).map((a) => <span key={a.id}>{a.thumb ? <img src={a.thumb} alt="" /> : null}</span>)}{n > 4 && <em>+{n - 4}</em>}</div>
          <div>
            <h2>{act ? act.title : 'Make…'}</h2>
            <p className="tip">{act ? `From ${titleFor}` : `New versions of ${titleFor}, made from what you already have.`}</p>
          </div>
        </div>

        {!act && (
          <div className="mm-grid">
            {actions.map((a) => {
              const off = !a.batch && n > 1;
              const d = actionDesigns(a);
              return (
                <button key={a.id} type="button" className="mm-card" disabled={off} onClick={() => pick(a)}>
                  <b>{a.title}</b>
                  <span>{a.blurb}</span>
                  <small>{off ? 'One image at a time' : a.kind === 'resize' ? 'No AI · doesn’t use designs' : `${d} design${d === 1 ? '' : 's'} per ${a.kind === 'video' ? 'clip' : 'photo'}`}{free ? ' · Pro' : ''}</small>
                </button>
              );
            })}
          </div>
        )}

        {act && !done && (
          <div className="mm-opts">
            {act.kind === 'resize' ? (
              <div className="mm-sizes" role="group" aria-label="Sizes">
                {SOCIAL_SIZES.map((s) => (
                  <label key={s.id} className={sizes.includes(s.id) ? 'on' : ''}>
                    <input type="checkbox" checked={sizes.includes(s.id)} onChange={() => setSizes((cur) => (cur.includes(s.id) ? cur.filter((x) => x !== s.id) : [...cur, s.id]))} />
                    <b>{s.label}</b><small>{s.w}×{s.h}</small>
                  </label>
                ))}
              </div>
            ) : (
              <>
                {act.choices && (
                  <div className="mm-chips" role="group" aria-label="Options">
                    {act.choices.map((c) => <button key={c} type="button" aria-pressed={choice === c} onClick={() => setChoice(choice === c ? '' : c)}>{c}</button>)}
                  </div>
                )}
                {act.ask && (
                  <label className="mm-ask">
                    <span className="label">{act.ask.label}</span>
                    <textarea className="in" rows={2} maxLength={500} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder={act.ask.placeholder} />
                  </label>
                )}
              </>
            )}
            {err && <p className="mm-err" role="alert">{err}</p>}
            <div className="mm-foot">
              <button className="btn quiet" type="button" disabled={busy} onClick={() => setAct(null)}>← Back</button>
              <span className="tip">
                {act.kind === 'resize'
                  ? `${sizes.length * n} ${sizes.length * n === 1 ? 'copy' : 'copies'}, saved next to the original`
                  : `Uses ${cost} design${cost === 1 ? '' : 's'} · saved to Review as ${act.kind === 'video' ? 'a draft' : 'drafts'}`}
              </span>
              <button className="primary" type="button" disabled={!ready || busy} onClick={make}>
                {busy ? (act.kind === 'resize' ? 'Resizing…' : act.kind === 'video' ? 'Starting…' : `Making… (about ${Math.max(15, 15 * n)}s)`) : act.kind === 'video' ? 'Make clip' : 'Make'}
              </button>
            </div>
          </div>
        )}

        {act && done && (
          <div className="mm-done">
            {act.kind === 'video' ? (
              clip ? (
                <div className="mm-results"><button type="button" className="mm-res" onClick={() => onOpen(clip.id)}>{clip.url && <video src={clip.url} muted autoPlay loop playsInline />}<span>{clip.name}</span></button></div>
              ) : <p className="mm-wait"><span className="spin" aria-hidden /> Making your clip{done.model ? ` with ${modelName(done.model)}` : ''}. It takes one to three minutes and appears in Review as a draft. You can close this.</p>
            ) : (
              done.results.map((r) => (
                <div key={r.source.id} className="mm-group">
                  {n > 1 && <div className="label">{r.source.name}</div>}
                  {r.error && <p className="mm-err">{r.error}</p>}
                  <div className="mm-results">
                    {r.assets.map((a) => (
                      <button key={a.id} type="button" className="mm-res" onClick={() => onOpen(a.id)} title={`Open ${a.name}`}>
                        {a.url && <img src={a.url} alt={a.name} />}
                        <span>{act.kind === 'resize' ? a.name.replace(/^.*\(([^)]+)\)$/, '$1') : 'Draft'}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
            <p className="tip">{act.kind === 'resize' ? 'Saved as copies next to the original, with the same tags and folder.' : act.kind === 'video' ? '' : `Made with ${modelName(done.model) || 'Mise'}. Saved to Review as drafts: approve them to use or share them.`}</p>
            <div className="mm-foot">
              <button className="btn" type="button" onClick={() => { setDone(null); setClip(null); }}>Try another option</button>
              <button className="btn quiet" type="button" onClick={() => setAct(null)}>Make something else</button>
              <button className="primary" type="button" onClick={onClose}>Done</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
