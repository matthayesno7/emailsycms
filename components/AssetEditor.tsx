'use client';
import { useEffect, useRef, useState } from 'react';
import { PRESETS } from '@/lib/blockTypes';
import { DEFAULT_CTA } from '@/lib/products';
import { cutWhite, drawFit, loadImg, toBlob } from '@/lib/images';
import { Icon } from './icons';
import type { Asset } from './Library';

const TYPES: [string, string][] = [['image', 'Image'], ['logo', 'Logo'], ['product', 'Product']];
const VIDEO_TYPES: [string, string][] = [['video', 'Video']];
type Focus = { x: number; y: number };

// Full-page editor for one image, logo or product image: a big canvas on the left,
// the settings on the right. Opens at ?asset=<id>, so it has its own link and Back works.
export default function AssetEditor({ it, src, usedIn = [], onOpenBlock, onClose, onPatch, onDelete, onMakeBlock, onPrev, onNext, position, toast }: {
  it: Asset;
  src: string | null;
  usedIn?: Asset[];
  onOpenBlock?: (b: Asset) => void;
  onClose: () => void;
  onPatch: (p: Record<string, any>) => Promise<boolean>;
  onDelete: () => void;
  onMakeBlock: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  position?: string;
  toast: (m: string) => void;
}) {
  const [preset, setPreset] = useState('orig');
  const [removeBg, setRemoveBg] = useState(false);
  const [mode, setMode] = useState<'result' | 'crop'>('result');
  const [zoom, setZoom] = useState<'fit' | '1x'>('fit');
  const [out, setOut] = useState<{ url: string; w: number; h: number; blob: Blob } | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  // focus follows the pointer while dragging; the result re-renders only when it's let go.
  const [focus, setFocus] = useState<Focus>(it.focus || { x: 0.5, y: 0.5 });
  const [renderFocus, setRenderFocus] = useState<Focus>(it.focus || { x: 0.5, y: 0.5 });
  const [confirmDel, setConfirmDel] = useState(false);
  const [name, setName] = useState(it.name);
  const cache = useRef<{ img?: HTMLImageElement; cut?: HTMLCanvasElement; src?: string }>({});
  const dragging = useRef(false);

  useEffect(() => setName(it.name), [it.name]);
  useEffect(() => { if (!dragging.current) { const f = it.focus || { x: 0.5, y: 0.5 }; setFocus(f); setRenderFocus(f); } }, [it.focus]);

  const isVideo = it.kind === 'video';
  const pr = PRESETS.find((p) => p.id === preset)!;
  const cropping = it.kind === 'image' && !!pr.w;
  useEffect(() => { if (!cropping) setMode('result'); }, [cropping]);

  // Render the email-ready version whenever the size, cut-out or focal point changes.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!src || isVideo) return;
      try {
        if (cache.current.src !== src) cache.current = { src, img: await loadImg(src) };
        const img = cache.current.img!;
        setNatural({ w: img.naturalWidth, h: img.naturalHeight });
        let source: HTMLImageElement | HTMLCanvasElement = img;
        if (removeBg) source = cache.current.cut || (cache.current.cut = cutWhite(img));
        const sw = (source as HTMLImageElement).naturalWidth || source.width, sh = (source as HTMLImageElement).naturalHeight || source.height;
        const tw = pr.w || sw, th = pr.h || sh;
        const cv = pr.w ? drawFit(source, tw, th, it.kind === 'image' ? 'cover' : 'contain', renderFocus, false, 0.86) : drawFit(source, tw, th, 'contain');
        const blob = await toBlob(cv, 'image/png');
        if (!alive) return;
        const made = URL.createObjectURL(blob);
        setOut((o) => { if (o) URL.revokeObjectURL(o.url); return { url: made, w: tw, h: th, blob }; });
      } catch {
        if (alive) toast('This image couldn’t be loaded.');
      }
    })();
    return () => { alive = false; };
  }, [src, preset, removeBg, renderFocus, it.kind, toast]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard: arrows move between assets (outside text fields), Esc goes back.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (/INPUT|TEXTAREA|SELECT/.test((document.activeElement as HTMLElement)?.tagName)) return;
      if (e.key === 'ArrowLeft' && onPrev) { e.preventDefault(); onPrev(); }
      if (e.key === 'ArrowRight' && onNext) { e.preventDefault(); onNext(); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onPrev, onNext]);

  // The crop box on the original, in 0..1 units (matches drawFit's cover maths).
  const box = (() => {
    if (!cropping || !natural) return null;
    const s = Math.max(pr.w! / natural.w, pr.h! / natural.h), cw = pr.w! / s / natural.w, ch = pr.h! / s / natural.h;
    return { x: Math.min(Math.max(focus.x - cw / 2, 0), 1 - cw), y: Math.min(Math.max(focus.y - ch / 2, 0), 1 - ch), w: cw, h: ch };
  })();

  const pointAt = (e: React.PointerEvent<HTMLElement>): Focus => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const round = (f: Focus) => ({ x: Math.round(f.x * 1000) / 1000, y: Math.round(f.y * 1000) / 1000 });
  async function commitFocus(f: Focus) {
    dragging.current = false;
    setFocus(f); setRenderFocus(f);
    if (await onPatch({ focus: round(f) })) toast('Focal point saved');
  }

  const fileName = () => (it.pid || it.name).replace(/[^\w.-]+/g, '-').toLowerCase() + (pr.w ? `-${pr.w}x${pr.h}` : '') + '.png';

  async function saveName() {
    const n = name.trim();
    if (!n) { setName(it.name); return; }
    if (n !== it.name && (await onPatch(it.kind === 'product' ? { name: n, fields: markEdited({}, 'name') } : { name: n }))) toast('Renamed');
  }
  // Product copy the team edits is kept when the feed syncs again.
  function markEdited(extra: Record<string, any>, key: string) {
    const f = it.fields || {};
    return { ...f, ...extra, edited: Array.from(new Set([...(f.edited || []), key])) };
  }
  async function saveCopy(key: 'eyebrow' | 'description' | 'cta' | 'alt', v: string) {
    if (await onPatch({ fields: markEdited({ [key]: v }, key) })) toast('Saved');
  }
  async function setKind(k: string) {
    if (k !== it.kind && (await onPatch({ kind: k }))) toast(`Moved to ${k === 'image' ? 'Images' : k === 'logo' ? 'Logos' : 'Products'}`);
  }
  async function copyImage() {
    if (!out) return;
    try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': out.blob })]); toast('Copied. Paste it into Figma.'); }
    catch { toast('Your browser blocked copying images. Use Download instead.'); }
  }
  function download() {
    if (!out) return;
    const a = document.createElement('a');
    a.href = out.url; a.download = fileName();
    document.body.appendChild(a); a.click(); a.remove();
  }
  const copyText = async (v?: string) => { if (!v) return; try { await navigator.clipboard.writeText(v); toast('Copied'); } catch { toast(v); } };

  const info = [natural && `${natural.w}×${natural.h}`, it.bytes && `${Math.round(it.bytes / 1024)} KB`, it.mime?.split('/')[1]?.toUpperCase()].filter(Boolean).join(' · ');

  return (
    <div className="editor" role="dialog" aria-modal="true" aria-label={`Editing ${it.name}`}>
      <header className="ed-bar">
        <button className="ghost" type="button" onClick={onClose} title="Back to the library (Esc)"><Icon.Back />Library</button>
        <div className="ed-title">
          <input className="title-in" value={name} maxLength={120} aria-label="Asset name" title="Rename"
            onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          <div className="sub">{info || 'No image yet'}</div>
        </div>
        <span className="spacer" />
        {(onPrev || onNext) && (
          <div className="ed-nav">
            <button className="x" type="button" aria-label="Previous asset" disabled={!onPrev} onClick={onPrev}><Icon.Chevron /></button>
            {position && <span>{position}</span>}
            <button className="x" type="button" aria-label="Next asset" disabled={!onNext} onClick={onNext}><Icon.Chevron /></button>
          </div>
        )}
        {src && isVideo && <a className="btn" href={src} download={`${it.name.replace(/[^\w.-]+/g, '-')}.mp4`} target="_blank" rel="noreferrer">Download</a>}
        {src && !isVideo && <>
          <button className="btn" type="button" onClick={download} disabled={!out}><span className="lbl">Download</span><span className="sm">PNG</span></button>
          <button className="primary" type="button" onClick={copyImage} disabled={!out}>Copy image</button>
        </>}
      </header>

      <div className="ed-body">
        <section className="ed-canvas" aria-label="Canvas">
          <div className="ed-tools">
            {cropping && !isVideo && (
              <div className="seg" role="group" aria-label="View">
                <button type="button" aria-pressed={mode === 'result'} onClick={() => setMode('result')}>Result</button>
                <button type="button" aria-pressed={mode === 'crop'} onClick={() => setMode('crop')}>Adjust crop</button>
              </div>
            )}
            <span className="spacer" />
            {mode === 'result' && !isVideo && (
              <div className="seg" role="group" aria-label="Zoom">
                <button type="button" aria-pressed={zoom === 'fit'} onClick={() => setZoom('fit')}>Fit</button>
                <button type="button" aria-pressed={zoom === '1x'} onClick={() => setZoom('1x')}>100%</button>
              </div>
            )}
          </div>

          <div className={'ed-stage' + (zoom === '1x' && mode === 'result' ? ' actual' : '') + (it.kind !== 'image' ? ' light' : '')}>
            {isVideo && src ? (
              <video className="ed-out" src={src} controls playsInline autoPlay muted loop />
            ) : !src ? (
              <p className="tip">No image yet.{it.pid ? <> Drop <code>{it.pid}.jpg</code> (or .png) onto the library and it attaches to this product.</> : null}</p>
            ) : mode === 'crop' && box ? (
              <div className="ed-crop"
                onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); setFocus(pointAt(e)); }}
                onPointerMove={(e) => { if (dragging.current) setFocus(pointAt(e)); }}
                onPointerUp={(e) => commitFocus(pointAt(e))}>
                <img src={src} alt="" draggable={false} />
                <div className="ed-box" style={{ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` }}>
                  <span>{pr.w}×{pr.h}</span>
                </div>
                <i className="ed-focus" style={{ left: `${focus.x * 100}%`, top: `${focus.y * 100}%` }} />
              </div>
            ) : out ? (
              <img className="ed-out" src={out.url} alt="Email-ready image" draggable data-drag={fileName()} data-png="1"
                onPointerDown={(e) => { if (it.kind === 'image' && preset === 'orig') setFocus(pointAt(e)); }}
                onPointerUp={(e) => { if (it.kind === 'image' && preset === 'orig') commitFocus(pointAt(e)); }} />
            ) : <p className="tip">Preparing…</p>}
            {src && out && !isVideo && (
              <span className="hint">{mode === 'crop' ? 'Drag to choose what stays in the crop' : `${out.w}×${out.h}${removeBg ? ' · cut out' : ''} · drag into Figma`}</span>
            )}
          </div>
        </section>

        <aside className="ed-side" aria-label="Settings">
          {it.origin === 'generated' && (
            <div className={'origin-box' + (it.status === 'draft' ? ' draft' : '')}>
              <div className="bl"><b>{it.status === 'draft' ? 'Generated · waiting for approval' : 'Generated · approved'}</b>
                {it.status === 'draft' && <button className="primary" type="button" onClick={async () => { if (await onPatch({ status: 'approved' })) toast('Approved'); }}>Approve</button>}
              </div>
              {it.provenance?.prompt && <p className="tip">“{it.provenance.prompt}”</p>}
              <p className="tip">{[it.provenance?.model, it.provenance?.style, it.provenance?.source_product_pid && `from product ${it.provenance.source_product_pid}`, it.provenance?.brand_kit_version && `brand kit v${it.provenance.brand_kit_version}`].filter(Boolean).join(' · ')}</p>
            </div>
          )}

          <div className="ed-sec">
            <div className="label">Type</div>
            <div className="seg" role="group" aria-label="Asset type">
              {(isVideo ? VIDEO_TYPES : TYPES).map(([k, l]) => <button key={k} type="button" aria-pressed={it.kind === k} onClick={() => setKind(k)}>{l}</button>)}
            </div>
          </div>

          {src && !isVideo && (
            <div className="ed-sec">
              <div className="label">Size for email</div>
              <div className="ed-sizes">
                {PRESETS.map((p) => (
                  <button key={p.id} className="chip" type="button" aria-pressed={preset === p.id} onClick={() => { setPreset(p.id); if (p.w && it.kind === 'image') setMode('crop'); }}>
                    <b>{p.name}</b>{p.w ? <span>{p.w}×{p.h}</span> : <span>as uploaded</span>}
                  </button>
                ))}
              </div>
              <label className="toggle"><input type="checkbox" checked={removeBg} onChange={(e) => setRemoveBg(e.target.checked)} /> Remove white background</label>
              <p className="tip">
                {it.kind === 'image' ? 'Pick a size, then drag on the image to choose what stays in. The focal point is saved and used for every crop, including blocks. ' : ''}
                Drag the result onto your Figma canvas, or copy it and press <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>R</kbd> on a selected layer to replace its image.
              </p>
            </div>
          )}

          {src && it.kind !== 'product' && !isVideo && (
            <div className="ed-sec">
              <div className="label">Alt text</div>
              <div className="fields">
                <ProductField label="Alt" long value={it.fields?.alt || ''} placeholder="Describe the image for people who can’t see it" onSave={async (v) => { if (await onPatch({ fields: { ...(it.fields || {}), alt: v } })) toast('Saved'); }} onCopy={copyText} />
              </div>
            </div>
          )}

          {it.kind === 'product' && (
            <div className="ed-sec">
              <div className="label">Product</div>
              <div className="fields">
                <ProductField label="Label" value={it.fields?.eyebrow || ''} placeholder="e.g. New in" onSave={(v) => saveCopy('eyebrow', v)} onCopy={copyText} />
                <ProductField label="Description" long value={it.fields?.description || ''} placeholder="Short description for email" onSave={(v) => saveCopy('description', v)} onCopy={copyText} />
                <ProductField label="Alt text" long value={it.fields?.alt || ''} placeholder="Describe the product image" onSave={(v) => saveCopy('alt', v)} onCopy={copyText} />
                <ProductField label="Button" value={it.fields?.cta ?? DEFAULT_CTA} placeholder="No button" onSave={(v) => saveCopy('cta', v)} onCopy={copyText} />
                {([['Price', 'price'], ['Link', 'link'], ['PID', 'pid']] as [string, string][]).map(([label, f]) => (
                  <ProductField key={f} label={label} mono value={it[f] || ''} onSave={async (v) => { if (await onPatch({ [f]: v || null })) toast('Saved'); }} onCopy={copyText} />
                ))}
              </div>
              <p className="tip">Name, label, description and button are yours: a feed sync won’t overwrite them once edited. Price, link and image always follow the feed.</p>
            </div>
          )}

          {isVideo && <p className="tip">Videos go into Figma, social and ads as they are. For email, most inboxes don’t play video: use a still or an animated GIF with a link to it.</p>}
          {!isVideo && <div className="ed-sec">
            <div className="label">In email</div>
            <div className="usedin">
              <button type="button" className="btn" onClick={() => (src || it.kind === 'product' ? onMakeBlock() : toast('Add an image first.'))}>Use in a block</button>
              {usedIn.map((b) => <button key={b.id} type="button" title="Open block" onClick={() => onOpenBlock?.(b)}>{b.name}</button>)}
            </div>
            <p className="tip">{usedIn.length ? `Used in ${usedIn.length} block${usedIn.length > 1 ? 's' : ''}. It stays here in your assets.` : 'Blocks use this asset without moving it; it stays here.'}
              {it.images?.email ? ` Email-ready copy: ${it.images.email.width}×${it.images.email.height}, ${Math.round(it.images.email.bytes / 1024)} KB.` : ''}</p>
          </div>}

          {it.provenance?.via === 'brand_kit' && <p className="tip">Imported from {hostOf(it.provenance.site || it.provenance.imported_from)} when the brand kit was built.</p>}

          <div className="fill" />
          <div className="actions">
            {confirmDel ? (
              <><span className="tip">Delete for everyone?</span><button className="btn" type="button" onClick={onDelete}>Delete</button><button className="btn quiet" type="button" onClick={() => setConfirmDel(false)}>Keep</button></>
            ) : (
              <button className="btn quiet" type="button" onClick={() => setConfirmDel(true)}>Delete asset</button>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function hostOf(u?: string) { try { return new URL(u || '').hostname.replace(/^www\./, ''); } catch { return 'the website'; } }

function ProductField({ label, value, onSave, onCopy, long, mono, placeholder }: { label: string; value: string; onSave: (v: string) => void; onCopy: (v: string) => void; long?: boolean; mono?: boolean; placeholder?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const ph = placeholder || `Add ${label.toLowerCase()}`;
  return (
    <div className="field">
      <span className="k">{label}</span>
      {long ? (
        <textarea className="v fin" rows={3} maxLength={300} value={v} placeholder={ph} aria-label={label}
          onChange={(e) => setV(e.target.value)} onBlur={() => v.trim() !== value && onSave(v.trim())} />
      ) : (
        <input className={'v fin' + (mono ? ' mono' : '')} value={v} placeholder={ph} aria-label={label}
          onChange={(e) => setV(e.target.value)} onBlur={() => v.trim() !== value && onSave(v.trim())}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
      )}
      <button type="button" onClick={() => onCopy(v)}>Copy</button>
    </div>
  );
}
