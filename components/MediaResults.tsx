'use client';
import { useEffect } from 'react';
import { modelName } from '@/lib/models';

// What Create has made in Mise this visit: photos (ready at once) and video clips (ready in a minute or two).
export type MadeItem = {
  key: string; kind: 'photo' | 'video'; prompt: string; model: string; designs: number;
  status: 'making' | 'ready' | 'failed'; error?: string; job?: string;
  assets: { id: string; name: string; url: string | null }[];
};

export default function MediaResults({ items, wsId, onUpdate, onOpen, onAgain }: {
  items: MadeItem[]; wsId: string;
  onUpdate: (key: string, patch: Partial<MadeItem>) => void;
  onOpen: (id: string) => void; onAgain: (m: MadeItem) => void;
}) {
  // Check on clips every 8 seconds until they're saved.
  const waiting = items.filter((m) => m.kind === 'video' && m.status === 'making' && m.job);
  useEffect(() => {
    if (!waiting.length) return;
    const t = setInterval(() => {
      for (const m of waiting) {
        fetch(`/api/make/video?workspace_id=${wsId}&job=${encodeURIComponent(m.job!)}`).then((r) => r.json().then((j) => ({ ok: r.ok, j })))
          .then(({ ok, j }) => {
            if (!ok) onUpdate(m.key, { status: 'failed', error: j.error || 'The clip couldn’t be made.' });
            else if (j.ready) onUpdate(m.key, { status: 'ready', assets: [j.asset], model: j.model || m.model });
          }).catch(() => {});
      }
    }, 8000);
    return () => clearInterval(t);
  }, [waiting.map((m) => m.key).join(','), wsId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!items.length) return null;
  return (
    <div className="mk-list" aria-live="polite">
      {items.map((m) => (
        <div key={m.key} className="mk-item">
          <div className="mk-head">
            <span className="mk-what">{m.kind === 'video' ? 'Video' : m.assets.length > 1 ? `${m.assets.length} photos` : 'Photo'}</span>
            <span className="mk-prompt" title={m.prompt}>{m.prompt}</span>
            <span className="mk-model">Made with {modelName(m.model)}</span>
          </div>
          {m.status === 'making' && (
            <div className="mk-wait"><span className="st-spin" aria-hidden />
              {m.kind === 'video' ? `Making your clip with ${modelName(m.model)}. It usually takes one to three minutes; you can keep working and it saves to Review by itself.` : `Making with ${modelName(m.model)}…`}
            </div>
          )}
          {m.status === 'failed' && <p className="err mk-err">{m.error}</p>}
          {m.status === 'ready' && (
            <div className={'mk-grid' + (m.kind === 'video' ? ' video' : '')}>
              {m.assets.map((a) => (
                <button key={a.id} type="button" className="mk-tile" onClick={() => onOpen(a.id)} title={`Open ${a.name}`}>
                  {a.url ? (m.kind === 'video' ? <video src={a.url} muted loop autoPlay playsInline /> : <img src={a.url} alt={a.name} />) : <span>{a.name}</span>}
                </button>
              ))}
            </div>
          )}
          {m.status !== 'making' && (
            <div className="mk-actions">
              {m.status === 'ready' && <span className="tip">Saved to Review as {m.assets.length > 1 ? 'drafts' : 'a draft'} · {m.designs} design{m.designs === 1 ? '' : 's'}</span>}
              <span className="spacer" />
              <button type="button" className="btn quiet" onClick={() => onAgain(m)}>Make another</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
