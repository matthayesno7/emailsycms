'use client';
import { useState } from 'react';
import { BLOCK_TYPES } from '@/lib/blockTypes';
import { DEFAULT_CTA, productAsBlock } from '@/lib/products';
import { FitPreview, Preview } from './BlockEditor';
import type { Asset } from './Library';

// Edit mode for a product, on its asset page: the email card big on the left, its copy on the
// right (name, label, description, price, button, link). The photo has its own tools.
// Copy the team edits is kept when the feed syncs again; price, link and image follow the feed.
export default function ProductEditor({ it, src, onSave, onCancel, onPhoto, toast }: {
  it: Asset;
  src: string | null;
  onSave: (patch: Record<string, any>) => Promise<boolean>;
  onCancel: () => void;
  onPhoto?: () => void; // switch to the photo tools (crop, adjust)
  toast: (m: string) => void;
}) {
  const f0 = it.fields || {};
  const [v, setV] = useState({ name: it.name || '', eyebrow: f0.eyebrow || '', description: f0.description || '', cta: f0.cta ?? DEFAULT_CTA, price: it.price || '', link: it.link || '' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v, x: string) => setV((s) => ({ ...s, [k]: x }));
  const changed = v.name !== (it.name || '') || v.eyebrow !== (f0.eyebrow || '') || v.description !== (f0.description || '') || v.cta !== (f0.cta ?? DEFAULT_CTA) || v.price !== (it.price || '') || v.link !== (it.link || '');
  const card = productAsBlock({ ...it, name: v.name, price: v.price, link: v.link, fields: { ...f0, eyebrow: v.eyebrow, description: v.description, cta: v.cta } });

  async function save() {
    if (!v.name.trim()) { toast('A product needs a name.'); return; }
    setBusy(true);
    const edited = new Set<string>(f0.edited || []);
    for (const [k, was] of [['name', it.name], ['eyebrow', f0.eyebrow], ['description', f0.description], ['cta', f0.cta ?? DEFAULT_CTA]] as const) if ((v as any)[k] !== (was || '')) edited.add(k);
    const ok = await onSave({
      name: v.name.trim().slice(0, 120), price: v.price.trim() || null, link: v.link.trim() || null,
      fields: { ...f0, eyebrow: v.eyebrow.trim(), description: v.description.trim(), cta: v.cta.trim(), edited: [...edited] },
    });
    setBusy(false);
    if (ok) { toast('Product saved'); onCancel(); }
  }

  const field = (k: keyof typeof v, label: string, max: number, opts: { long?: boolean; mono?: boolean; placeholder?: string } = {}) => (
    <label className="de-field">
      <span>{label}{max < 200 ? <em className="count">{v[k].length}/{max}</em> : null}</span>
      {opts.long
        ? <textarea className="in" rows={3} maxLength={max} value={v[k]} placeholder={opts.placeholder} onChange={(e) => set(k, e.target.value)} />
        : <input className={'in' + (opts.mono ? ' mono' : '')} maxLength={max} value={v[k]} placeholder={opts.placeholder} onChange={(e) => set(k, e.target.value)} />}
    </label>
  );

  return (
    <div className="ed-body editing">
      <section className="ed-canvas" aria-label="Product card">
        <div className="ed-tools"><span className="tip">How it looks in an email, with your brand kit</span><span className="spacer" /></div>
        <div className="ed-stage light pe-stage">
          <div className="pe-card">
            <FitPreview width={300} fitHeight={false}>
              <Preview b={card} bt={BLOCK_TYPES.product.fields} slotSrc={() => src || undefined} />
            </FitPreview>
          </div>
        </div>
      </section>
      <aside className="ed-side ie-side" aria-label="Edit the product">
        <div className="ie-scroll">
          <div className="ed-sec">
            <div className="label">Product card</div>
            {field('eyebrow', 'Label', 30, { placeholder: 'e.g. New in' })}
            {field('name', 'Name', 60)}
            {field('description', 'Description', 160, { long: true, placeholder: 'Short description for email' })}
            {field('price', 'Price', 16, { placeholder: '£0.00' })}
            {field('cta', 'Button', 20, { placeholder: 'Leave empty for no button' })}
            {field('link', 'Link', 500, { mono: true, placeholder: 'https://' })}
            <p className="tip">Your edits to the name, label, description and button are kept when the feed syncs. Price, link and image follow the feed.</p>
          </div>
          {onPhoto && src && (
            <div className="ed-sec">
              <div className="label">Photo</div>
              <button type="button" className="btn" onClick={onPhoto}>Crop and adjust the photo</button>
            </div>
          )}
        </div>
        <div className="ie-save">
          <p className="tip">{changed ? 'Saving updates the product in Mise.' : 'Make a change to save it.'}</p>
          <div className="ie-row">
            <button className="btn quiet" type="button" onClick={onCancel} disabled={busy}>Cancel</button>
            <button className="primary grow" type="button" disabled={busy || !changed} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </aside>
    </div>
  );
}
