'use client';
import { useState } from 'react';
import { Icon } from './icons';
import type { Asset } from './Library';

// Edit mode for something made in Figma (by Claude, or sent there from Create): it's edited in
// Figma, where its layers live. Say what to change; Claude changes the Figma frame and saves it
// back here as the next version of this asset.
export default function FigmaEdit({ it, src, toast, onCancel }: { it: Asset; src: string | null; toast: (m: string) => void; onCancel: () => void }) {
  const [ask, setAsk] = useState('');
  const file = it.figma?.file_key ? `https://www.figma.com/design/${it.figma.file_key}${it.figma.node_id ? `?node-id=${String(it.figma.node_id).replace(':', '-')}` : ''}` : null;

  function send() {
    const change = ask.trim();
    if (!change) return;
    const prompt = [
      `Edit my Mise asset "${it.name}" (asset id ${it.id}). It was designed in Figma${file ? `: ${file}` : ''}.`,
      '',
      `Change: ${change}`,
      '',
      'Make the change in that Figma frame and keep everything else as it is (layout, fonts, colours, size). Then export the frame with download_assets and save it back to Mise with add_generated_asset, passing replaces_asset_id "' + it.id + '" so it becomes the next version of the same asset, not a new one.',
    ].join('\n');
    try { navigator.clipboard.writeText(prompt); } catch {}
    window.open(`https://claude.ai/new?q=${encodeURIComponent(prompt)}`, '_blank', 'noopener');
    toast('Sent to Claude. The new version shows up here when it’s saved.');
  }

  return (
    <div className="ed-body editing">
      <section className="ed-canvas" aria-label="Picture">
        <div className="ed-tools"><span className="tip">Made in Figma</span><span className="spacer" /></div>
        <div className="ed-stage">{src ? <img className="ed-out" src={src} alt={it.fields?.alt || it.name} /> : <p className="tip">No image yet.</p>}</div>
      </section>
      <aside className="ed-side ie-side" aria-label="Edit in Figma">
        <div className="ie-scroll">
          <div className="ed-sec">
            <div className="label">Edit in Figma</div>
            <p className="tip">This was made in Figma, so it’s edited in Figma, where its layers are. Say what to change: Claude makes the change in the Figma frame and saves it back here as version {(it.version || 1) + 1}. The current version is kept.</p>
            <textarea className="in" rows={5} value={ask} autoFocus onChange={(e) => setAsk(e.target.value)}
              placeholder={'e.g. Change the headline to “Design & build email”, and remove the URL pill'} />
            <button type="button" className="primary" disabled={!ask.trim()} onClick={send}><Icon.Sparkle size={15} />Make the change with Claude</button>
            {file && <a className="btn" href={file} target="_blank" rel="noreferrer">Open it in Figma</a>}
          </div>
          {it.text_in_image && (
            <div className="ed-sec">
              <div className="label">Words in it now</div>
              <p className="tip words-now">{it.text_in_image}</p>
            </div>
          )}
        </div>
        <div className="ie-save">
          <div className="ie-row"><button className="btn quiet" type="button" onClick={onCancel}>Done</button></div>
        </div>
      </aside>
    </div>
  );
}
