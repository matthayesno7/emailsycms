'use client';
import { useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BLOCK_TYPES, exportSize, type BlockField } from '@/lib/blockTypes';
import { cropCanvas, drawFit, loadImg, toBlob } from '@/lib/images';
import { cardFromReading, readDesign } from '@/lib/extract';
import { Icon } from './icons';
import type { Asset } from './Library';

export default function BlockEditor({ draft, ws, userId, library, urls, appUrl, figmaFile, supabase, toast, onClose, onSaved, onDelete }: {
  draft: any;
  ws: string;
  userId: string;
  library: Asset[];
  urls: Record<string, string>;
  appUrl: string;
  figmaFile?: { url: string; name: string } | null;
  supabase: SupabaseClient;
  toast: (m: string) => void;
  onClose: () => void;
  onSaved: (row: Asset, convertedFrom?: string | null) => void;
  onDelete: (b: Asset) => void;
}) {
  const [b, setB] = useState<any>(draft);
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [reading, setReading] = useState(false);
  const bt = BLOCK_TYPES[b.block_type] || BLOCK_TYPES.hero;
  const saved = !!b.id;
  const byId = (id?: string) => library.find((i) => i.id === id);
  const srcOfAsset = (a?: Asset) => (a?.storage_path ? urls[a.storage_path] : undefined);
  // A changed slot previews its source: a library asset, or the block's own original upload.
  const slotSrc = (slot: any) => (slot?.path && !slot.dirty ? urls[slot.path] : srcOfAsset(byId(slot?.source_asset_id)) || (slot?.original_path ? urls[slot.original_path] : undefined));
  const pickable = library.filter((i) => i.kind !== 'block' && i.storage_path && urls[i.storage_path]);
  const products = library.filter((i) => i.kind === 'product');

  const setField = (k: string, v: string) => setB((x: any) => {
    const next = { ...x, fields: { ...x.fields, [k]: v } };
    // Changing the layout re-crops the image for its new shape.
    if (k === 'layout' && x.images?.image && (x.images.image.original_path || x.images.image.source_asset_id)) next.images = { ...x.images, image: { ...x.images.image, dirty: true } };
    return next;
  });
  const setImage = (k: string, v: any) => setB((x: any) => ({ ...x, images: { ...x.images, [k]: v } }));

  // Switching type re-renders each image from its original at the new type's size.
  function setType(t: string) {
    setB((x: any) => {
      const images = { ...x.images };
      for (const d of BLOCK_TYPES[t]?.fields.filter((f) => f.type === 'image') || []) {
        const slot = images[d.k];
        if (slot && (slot.original_path || slot.source_asset_id)) images[d.k] = { ...slot, dirty: true };
      }
      return { ...x, block_type: t, images };
    });
  }

  function fillFromProduct(id: string) {
    const p = byId(id);
    if (!p) return;
    setB((x: any) => ({
      ...x,
      product_id: p.id,
      name: !x.name || /block$/.test(x.name) ? p.name : x.name,
      fields: { ...x.fields, name: p.name, body: p.fields?.description || x.fields.body || '', price: p.price || '', link: p.link || '', cta: x.fields.cta || p.fields?.cta || 'Shop now' },
      images: p.storage_path ? { ...x.images, image: { source_asset_id: p.id, alt: p.name, dirty: true, original_path: p.storage_path } } : x.images,
    }));
  }

  async function save() {
    const over = bt.fields.find((d) => d.max && (b.fields[d.k] || '').length > d.max);
    if (over) { toast(`${over.label} is longer than ${over.max} characters.`); return; }
    setSaving(true);
    try {
      const images = { ...b.images };
      for (const d of bt.fields.filter((d) => d.type === 'image')) {
        const slot = images[d.k];
        if (!slot?.dirty) continue;
        const src = byId(slot.source_asset_id);
        let url = srcOfAsset(src);
        if (!url && slot.original_path) {
          const { data } = await supabase.storage.from('assets').createSignedUrl(slot.original_path, 600);
          url = data?.signedUrl;
        }
        if (!url) continue;
        const img = await loadImg(url);
        const source = !src && slot.crop ? cropCanvas(img, slot.crop) : img;
        const sw = (source as any).naturalWidth || source.width, sh = (source as any).naturalHeight || source.height;
        const { w, h } = exportSize(d, sw, sh, b.fields?.layout);
        const cv = drawFit(source, w, h, d.fit || 'cover', src?.focus, !d.png, d.fit === 'contain' ? 0.92 : 1);
        const type = d.png ? 'image/png' : 'image/jpeg';
        const blob = await toBlob(cv, type, d.natural ? 0.92 : 0.86);
        const path = `${ws}/blocks/${crypto.randomUUID()}.${d.png ? 'png' : 'jpg'}`;
        const { error } = await supabase.storage.from('assets').upload(path, blob, { contentType: type });
        if (error) throw error;
        if (slot.path) await supabase.storage.from('assets').remove([slot.path]);
        images[d.k] = { path, width: w, height: h, format: d.png ? 'png' : 'jpg', bytes: blob.size, alt: slot.alt || '', source_asset_id: src?.id || slot.source_asset_id || null, original_path: slot.original_path || src?.storage_path || null, ...(!src && slot.crop ? { crop: slot.crop } : {}) };
      }
      const row = {
        workspace_id: b.workspace_id || ws, kind: 'block', block_type: b.block_type, name: (b.name || `${bt.name} block`).trim().slice(0, 120),
        fields: b.fields, images, product_id: b.product_id || null,
      };
      const res = b.id
        ? await supabase.from('assets').update(row).eq('id', b.id).select('*').single()
        : await supabase.from('assets').insert({ ...row, created_by: userId }).select('*').single();
      if (res.error) throw res.error;
      let convertedFrom: string | null = null;
      if (b.convertFrom) {
        const from = byId(b.convertFrom);
        // Products stay in Products (they belong to the feed); images and logos move into Blocks.
        if (from && from.kind !== 'product') { await supabase.from('assets').delete().eq('id', from.id); convertedFrom = from.id; }
      }
      const next = { ...res.data, fields: { ...(res.data.fields || {}) }, images: JSON.parse(JSON.stringify(res.data.images || {})) };
      setB(next);
      onSaved(res.data as Asset, convertedFrom);
      toast(convertedFrom ? 'Moved to Blocks. Images are email-ready.' : 'Block saved. Images are email-ready.');
    } catch (err: any) {
      toast(`Couldn’t save the block${err?.message ? `: ${err.message}` : '.'}`);
    } finally {
      setSaving(false);
    }
  }

  // Design block -> editable Card: Claude reads the copy and finds the photo.
  async function readIntoCard() {
    const slot = b.images?.image;
    const path = slot?.original_path || slot?.path;
    if (!b.id || !path) { toast('Save the block with an image first.'); return; }
    setReading(true);
    try {
      const { data } = await supabase.storage.from('assets').createSignedUrl(path, 600);
      if (!data?.signedUrl) throw new Error('Could not open the image');
      const img = await loadImg(data.signedUrl);
      const r = await readDesign(img, b.workspace_id || ws);
      if (!r.ok) {
        toast(r.reason === 'not_configured' ? 'Add an Anthropic API key to Railway to let Emailsy read designs.' : r.reason === 'not_a_design' ? 'No copy found in this image.' : `Couldn’t read the design${r.message ? `: ${r.message}` : '.'}`);
        return;
      }
      const built = await cardFromReading({ supabase, ws: b.workspace_id || ws, img, originalPath: path, reading: r.reading, crop: r.crop });
      if (slot?.path && slot.path !== path) await supabase.storage.from('assets').remove([slot.path]);
      const res = await supabase.from('assets').update({ ...built, name: b.name && !/block$/.test(b.name) ? b.name : r.reading.headline || b.name }).eq('id', b.id).select('*').single();
      if (res.error) throw res.error;
      setB({ ...res.data, fields: { ...(res.data.fields || {}) }, images: JSON.parse(JSON.stringify(res.data.images || {})) });
      onSaved(res.data as Asset, null);
      toast('Design read and turned into a Card. Check the copy.');
    } catch (err: any) {
      toast(`Couldn’t read the design${err?.message ? `: ${err.message}` : '.'}`);
    } finally {
      setReading(false);
    }
  }

  const where = figmaFile ? ` (${figmaFile.url})` : ': [paste your Figma file link]';
  const prompt = !saved
    ? ''
    : b.block_type === 'design'
    ? `Using Emailsy CMS, rebuild my design block "${b.name}" (id ${b.id}) as an editable component in my design system${where}. Look at the design first, keep the photo as an image, and turn all the text into live text laid out exactly as in the design.`
    : `Using Emailsy CMS, turn my block "${b.name}" (id ${b.id}) into a ${bt.name.toLowerCase()} component and add it to my design system${where}.`;

  return (
    <aside className="sheet wide" role="dialog" aria-modal="true" aria-label={b.name}>
      <header>
        <div style={{ flex: 1, minWidth: 0 }}>
          <input className="title-in" value={b.name} maxLength={120} aria-label="Block name" onChange={(e) => setB({ ...b, name: e.target.value })} />
          <div className="sub">
            <select className="bsel" aria-label="Block type" value={b.block_type} onChange={(e) => setType(e.target.value)}>
              {Object.entries(BLOCK_TYPES).map(([k, t]) => <option key={k} value={k}>{t.name} block</option>)}
            </select>
          </div>
        </div>
        <button className="x" type="button" aria-label="Close" onClick={onClose}><Icon.Close /></button>
      </header>

      <div className="pvwrap"><Preview b={b} bt={bt.fields} slotSrc={slotSrc} /></div>

      {b.block_type === 'design' && saved && (
        <div className="bf readcard">
          <p className="tip">Emailsy can read this design, keep the photo and turn the copy into an editable Card that matches your other blocks.</p>
          <button className="btn" type="button" disabled={reading} onClick={readIntoCard}>{reading ? 'Reading the design…' : 'Turn into an editable Card'}</button>
        </div>
      )}

      {b.block_type === 'product' && (
        <div className="bf">
          <div className="bl"><label htmlFor="bprod">Fill from product</label></div>
          <select className="in" id="bprod" value={b.product_id || ''} onChange={(e) => fillFromProduct(e.target.value)}>
            <option value="">{products.length ? 'Choose a product…' : 'Import a product feed first'}</option>
            {products.map((p) => <option key={p.id} value={p.id}>{p.pid} · {p.name}</option>)}
          </select>
        </div>
      )}

      {bt.fields.map((d) => {
        const v = b.fields[d.k] || '';
        if (d.type === 'image') {
          const slot = b.images[d.k];
          const s = slotSrc(slot);
          const src = byId(slot?.source_asset_id);
          return (
            <div className="bf" key={d.k}>
              <div className="bl"><label>{d.label}</label><span className="cnt">{d.natural ? (slot?.width && !slot.dirty ? `${slot.width}×${slot.height}` : `up to ${(d.w || 600) * 2}px wide, same shape`) : `${(d.w || 0) * 2}×${(d.h || 0) * 2}`} {d.png ? 'PNG' : 'JPG'}</span></div>
              <div className="slot">
                <div className={'sthumb ' + d.fit}>{s && <img src={s} alt="" />}</div>
                <div className="sinfo">
                  <span>{src ? src.name : s ? 'Saved image' : 'No image chosen'}</span>
                  <button className="btn" type="button" onClick={() => setPickFor(pickFor === d.k ? null : d.k)}>{s ? 'Change' : 'Choose image'}</button>
                </div>
              </div>
              {pickFor === d.k && (
                <div className="picker">
                  {pickable.length ? pickable.map((i) => (
                    <button key={i.id} type="button" className={'pk ' + i.kind} title={i.name}
                      onClick={() => { setImage(d.k, { ...(slot || {}), source_asset_id: i.id, alt: i.name, dirty: true, original_path: i.storage_path, crop: undefined }); setPickFor(null); }}>
                      <img src={urls[i.storage_path]} alt={i.name} />
                    </button>
                  )) : <p className="tip">Upload images first, then pick one here.</p>}
                </div>
              )}
              {s && <input className="in" placeholder="Alt text" maxLength={120} value={slot?.alt || ''} onChange={(e) => setImage(d.k, { ...slot, alt: e.target.value })} />}
            </div>
          );
        }
        if (d.type === 'choice') {
          return (
            <div className="bf" key={d.k}>
              <div className="bl"><label htmlFor={'bf-' + d.k}>{d.label}</label></div>
              <select className="in" id={'bf-' + d.k} value={v || (d.k === 'layout' ? 'top' : '')} onChange={(e) => setField(d.k, e.target.value)}>
                {(d.options || []).map(([ov, ol]) => <option key={ov} value={ov}>{ol}</option>)}
              </select>
            </div>
          );
        }
        return (
          <div className="bf" key={d.k}>
            <div className="bl"><label>{d.label}</label>{d.max ? <span className={'cnt' + (v.length > d.max ? ' over' : '')}>{v.length}/{d.max}</span> : null}</div>
            {d.type === 'long'
              ? <textarea className="in" rows={3} value={v} onChange={(e) => setField(d.k, e.target.value)} />
              : <input className={'in' + (d.type === 'url' ? ' mono' : '')} type={d.type === 'url' ? 'url' : 'text'} placeholder={d.type === 'url' ? 'https://' : ''} value={v} onChange={(e) => setField(d.k, e.target.value)} />}
          </div>
        );
      })}

      {saved && (
        <div className="figma">
          <div className="label">Make it a Figma component</div>
          <p className="tip">{b.block_type === 'design'
            ? 'Ask Claude with the Emailsy CMS and Figma connectors on. It looks at this design, keeps the photo as an image and rebuilds the text as live, editable text in your design system.'
            : 'Ask Claude with the Emailsy CMS and Figma connectors on. It builds a component from this block in the design system you choose, using your styles.'}</p>
          <div className="promptbox">{prompt}</div>
          <button className="btn" type="button" onClick={async () => { try { await navigator.clipboard.writeText(prompt); toast('Copied. Paste it to Claude.'); } catch { toast(prompt); } }}>Copy request for Claude</button>
          {b.figma?.node_id && <p className="tip">In Figma: file {b.figma.file_key}, node {b.figma.node_id}.</p>}
        </div>
      )}

      <div className="fill" />
      <div className="actions">
        {confirmDel ? (
          <><span className="tip">Delete this block?</span><button className="btn" type="button" onClick={() => onDelete(b)}>Delete</button><button className="btn quiet" type="button" onClick={() => setConfirmDel(false)}>Keep</button></>
        ) : (
          <>
            <button className="primary" type="button" disabled={saving} onClick={save}>{saving ? 'Making images email-ready…' : saved ? 'Save changes' : 'Save block'}</button>
            <button className="btn quiet" type="button" onClick={onClose}>Close</button>
            <span className="spacer" />
            {saved && <button className="btn quiet" type="button" onClick={() => setConfirmDel(true)}>Delete</button>}
          </>
        )}
      </div>
    </aside>
  );
}

export function Preview({ b, bt, slotSrc, drag }: { b: any; bt: BlockField[]; slotSrc: (s: any) => string | undefined; drag?: { name: string; png: boolean } }) {
  const f = b.fields || {};
  const layout = b.block_type === 'card' ? f.layout || 'top' : 'top';
  const side = layout === 'left' || layout === 'right';
  const imgs = bt.filter((d) => d.type === 'image').map((d) => {
    const s = slotSrc(b.images?.[d.k]);
    if (d.natural) return <div key={d.k} className="pv-img natural">{s && <img src={s} alt="" />}</div>;
    const ar = side && d.side ? `${d.side.w}/${d.side.h}` : `${d.w}/${d.h}`;
    const dragProps = drag ? { draggable: true, 'data-drag': drag.name, 'data-png': drag.png ? '1' : '0' } : { draggable: false };
    return <div key={d.k} className={'pv-img ' + d.fit} style={{ aspectRatio: ar }}>{s && <img src={s} alt="" {...dragProps} />}</div>;
  });
  const texts = b.block_type === 'design' ? [] : bt.filter((d) => d.type !== 'image' && d.type !== 'url' && d.k !== 'layout').map((d) => {
    const v = f[d.k];
    if (!v) return null;
    if (d.k === 'rating') return <div key={d.k} className="pv-stars" aria-label={`${v} stars`}>{'★'.repeat(Number(v) || 0)}</div>;
    const cls = /cta/.test(d.k) ? 'pv-btn'
      : d.k === 'eyebrow' ? 'pv-e'
      : d.k === 'name' && b.block_type === 'card' ? 'pv-name'
      : /headline|name/.test(d.k) ? 'pv-h'
      : /subhead|price/.test(d.k) ? 'pv-s' : 'pv-p';
    return <div key={d.k} className={cls}>{v}</div>;
  });
  if (side) return <div className={'pv pv-card side ' + layout}>{imgs}<div className="pv-txt">{texts}</div></div>;
  return <div className={'pv pv-' + b.block_type}>{imgs}{texts}</div>;
}

// Scales a fixed-width preview down so all of it fits its container (width and height), centred.
export function FitPreview({ children, width = 320 }: { children: React.ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ k: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current, inn = inner.current;
    if (!el || !inn) return;
    const measure = () => {
      const host = el.parentElement || el;
      const cs = getComputedStyle(host);
      const availW = host.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const availH = host.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const h = inn.offsetHeight || 1;
      const k = Math.max(0.1, Math.min(availW / width, availH / h));
      setBox({ k, h });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(inn);
    if (el.parentElement) ro.observe(el.parentElement);
    measure();
    return () => ro.disconnect();
  }, [width]);
  return (
    <div ref={ref} className="fitpv">
      <div style={{ width: box ? width * box.k : '100%', height: box ? box.h * box.k : undefined, overflow: 'hidden', margin: '0 auto' }}>
        <div ref={inner} style={{ width, transform: `scale(${box?.k ?? 0.5})`, transformOrigin: 'top left' }}>{children}</div>
      </div>
    </div>
  );
}
