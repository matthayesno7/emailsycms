'use client';
import { useState } from 'react';
import { Modal } from './Modals';

const KINDS = [['bug', 'Something’s broken'], ['idea', 'An idea'], ['question', 'A question'], ['praise', 'Something I like']] as const;

// Feedback from anywhere in the app: goes straight to the Mise team, with the page it came from.
export default function Feedback({ ws, page, onClose, toast }: { ws?: string | null; page: string; onClose: () => void; toast: (m: string) => void }) {
  const [kind, setKind] = useState<string>('idea');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    setBusy(true); setErr('');
    const r = await fetch('/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, message, workspace_id: ws, page }) }).catch(() => null);
    setBusy(false);
    if (!r?.ok) { const j = r ? await r.json().catch(() => null) : null; setErr(j?.error || 'Couldn’t send that. Try again in a moment.'); return; }
    toast('Thanks. That’s gone straight to the Mise team.');
    onClose();
  }

  return (
    <Modal onClose={onClose}>
      <form className="feedback" onSubmit={send}>
        <h2>Send feedback</h2>
        <p className="tip">Tell us what’s working, what isn’t, or what you wish Mise did. It goes straight to the founders, and we read every one.</p>
        <div className="fb-kinds" role="radiogroup" aria-label="What kind of feedback">
          {KINDS.map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} className={'chip' + (kind === k ? ' on' : '')} onClick={() => setKind(k)}>{l}</button>
          ))}
        </div>
        <label className="bl" htmlFor="fb-msg"><span>Your message</span></label>
        <textarea id="fb-msg" className="in" rows={6} autoFocus value={message} onChange={(e) => setMessage(e.target.value)}
          placeholder={kind === 'bug' ? 'What did you do, and what happened?' : 'What’s on your mind?'} />
        {err && <p className="err">{err}</p>}
        <div className="actions">
          <button className="btn quiet" type="button" onClick={onClose}>Cancel</button>
          <button className="primary" type="submit" disabled={busy || !message.trim()}>{busy ? 'Sending…' : 'Send'}</button>
        </div>
      </form>
    </Modal>
  );
}
