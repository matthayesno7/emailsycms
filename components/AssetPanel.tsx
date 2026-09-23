'use client';
import { useEffect, useRef, useState } from 'react';
import { PRESETS } from '@/lib/blockTypes';
import { DEFAULT_CTA } from '@/lib/products';
import { cutWhite, drawFit, loadImg, toBlob } from '@/lib/images';
import { Icon } from './icons';
import type { Asset } from './Library';

const TYPES: [string, string][] = [['image', 'Image'], ['logo', 'Logo'], ['product', 'Product']];

export default function AssetPanel({ it, src, usedIn = [], onOpenBlock, onClose, onPatch, onDelete, onMakeBlock, toast }: {
  it: Asset;
  usedIn?: Asset[];
  onOpenBlock?: (b: Asset) => void;
  src: string | null;
  onClose: () => void;
  onPatch: (p: Record<string, any>) => Promise<boolean>;
  onDelete: () => void;
  onMakeBlock: () => void;
  toast: (m: string) => void;
}) {
  const [preset, setPreset] = useState('orig');
  const [removeBg, setRemoveBg] = useState(false);
  const [out, setOut] = useState<{ url: string; w: number; h: number; blob: Blob } | null>(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [name, setName] = useState(it.name);
  const cache = useRef<{ img?: HTMLImageElement; cut?: HTMLCanvasElement; src?: string }>({});
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { closeRef.current?.focus(); }, []);
  useEffect(() => setName(it.name), [it.name]);

  // Render the email-ready version whenever the size, cut-out or focal point changes.
  useEffect(() => {
    let alive = true, made = '';
    (async () => {
      if (!src) return;
      try {
        if (cache.current.src !== src) cache.current = { src, img: await loadImg(src) };
        let source: HTMLImageElement | HTMLCanvasElement = cache.current.img!;
        if (removeBg) source = cache.current.cut || (cache.current.cut = cutWhite(cache.current.img!));
        const pr = PRESETS.find((p) => p.id === preset)!;
        const sw = (source as HTMLImageElement).naturalWidth || source.width, sh = (source as HTMLImageElement).naturalHeight || source.height;
        const tw = pr.w || sw, th = pr.h || sh;
        const cv = pr.w ? drawFit(source, tw, th, it.kind === 'image' ? 'cover' : 'contain', it.focus, false, 0.86) : drawFit(source, tw, th, 'contain');
        const blob = await toBlob(cv, 'image/png');
        if (!alive) return;
        made = URL.createObjectURL(blob);
        setOut((o) => { if (o) URL.revokeObjectURL(o.url); return { url: made, w: tw, h: th, blob }; });
      } catch {
        if (alive) toast('This image couldn’t be loaded.');
      }
    })();
    return () => { alive = false; };
  }, [src, preset, removeBg, it.focus, it.kind, toast]);

  const fileName = () => {
    const pr = PRESETS.find((p) => p.id === preset)!;
    return (it.pid || it.name).replace(/[^\w.-]+/g, '-').toLowerCase() + (pr.w ? `-${pr.w}x${pr.h}` : '') + '.png';
  };

  async function saveName() {
    const n = name.trim();
    if (!n) { setName(it.name); return; }
    if (n !== it.name && (await onPatch(it.kind === 'product' ? { name: n, fields: markEdited({}, 'name') } : { name: n }))) toast('Renamed');
  }

  // Product copy the team edits is kept when the feed syncs again.
  function markEdited(extra: Record<string, any>, key: string) {
    const f = it.fields || {};
    const edited = Array.from(new Set([...(f.edited || []), key]));
    return { ...f, ...extra, edited };
  }
  async function saveCopy(key: 'eyebrow' | 'description' | 'cta', v: string) {
    const lock = key === 'description' ? 'description' : key;
    if (await onPatch({ fields: markEdited({ [key]: v }, lock) })) toast('Saved');
  }

  async function setKind(k: string) {
    if (k === it.kind) return;
    if (await onPatch({ kind: k })) toast(`Moved to ${k === 'image' ? 'Images' : k === 'logo' ? 'Logos' : 'Products'}`);
  }

  async function setFocus(e: React.MouseEvent<HTMLImageElement>) {
    if (it.kind !== 'image') return;
    if (preset !== 'orig') { toast('Switch to Original to set the focal point.'); return; }
    const r = e.currentTarget.getBoundingClientRect();
    const focus = { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
    if (await onPatch({ focus })) toast('Focal point set');
  }

  async function copyImage() {
    if (!out) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': out.blob })]);
      toast('Copied. Paste it into Figma.');
    } catch {
      toast('Your browser blocked copying images. Use Download instead.');
    }
  }

  function download() {
    if (!out) return;
    const a = document.createElement('a');
    a.href = out.url; a.download = fileName();
    document.body.appendChild(a); a.click(); a.remove();
  }

  const copyText = async (v?: string) => {
    if (!v) return;
    try { await navigator.clipboard.writeText(v); toast('Copied'); } catch { toast(v); }
  };

  return (
    <aside className="sheet" role="dialog" aria-modal="true" aria-label={it.name}>
      <header>
        <div style={{ flex: 1, minWidth: 0 }}>
          <input className="title-in" value={name} maxLength={120} aria-label="Asset name" title="Rename"
            onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          <div className="sub">{[it.width && `${it.width}×${it.height}`, it.bytes && `${Math.round(it.bytes / 1024)} KB`].filter(Boolean).join(' · ') || 'No image yet'}</div>
        </div>
        <button ref={closeRef} className="x" type="button" aria-label="Close" onClick={onClose}><Icon.Close /></button>
      </header>

      <div className="seg" role="group" aria-label="Asset type">
        {TYPES.map(([k, l]) => <button key={k} type="button" aria-pressed={it.kind === k} onClick={() => setKind(k)}>{l}</button>)}
      </div>

      <div>
        <div className="label">In email</div>
        <div className="usedin">
          <button type="button" className="btn" onClick={() => (src || it.kind === 'product' ? onMakeBlock() : toast('Add an image first.'))}>Use in a block</button>
          {usedIn.map((b) => <button key={b.id} type="button" title="Open block" onClick={() => onOpenBlock?.(b)}>{b.name}</button>)}
        </div>
        <p className="tip">{usedIn.length ? `Used in ${usedIn.length} block${usedIn.length > 1 ? 's' : ''}. It stays here in your assets.` : 'Blocks use this asset without moving it; it stays here.'}
          {it.images?.email ? ` Email-ready copy: ${it.images.email.width}×${it.images.email.height}, ${Math.round(it.images.email.bytes / 1024)} KB.` : ''}</p>
      </div>

      {src ? (
        <>
          <div className="stage">
            {out && <img src={out.url} alt="Email-ready image" draggable data-drag={fileName()} data-png="1" onClick={setFocus} />}
            <span className="hint">{out ? `${out.w}×${out.h}${removeBg ? ' · cut out' : ''} · drag into Figma` : 'Preparing…'}</span>
          </div>
          <div>
            <div className="label">Size for email</div>
            <div className="sizes">
              {PRESETS.map((p) => (
                <button key={p.id} className="chip" type="button" aria-pressed={preset === p.id} onClick={() => setPreset(p.id)}>
                  {p.name}{p.w && <span>{p.w}×{p.h}</span>}
                </button>
              ))}
            </div>
          </div>
          <label className="toggle"><input type="checkbox" checked={removeBg} onChange={(e) => setRemoveBg(e.target.checked)} /> Remove white background</label>
          <div className="actions">
            <button className="primary" type="button" onClick={copyImage}>Copy image</button>
            <button className="btn" type="button" onClick={download}>Download PNG</button>
          </div>
          <p className="tip">
            Drag the preview straight onto your Figma canvas, or copy it and press <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>R</kbd> on a selected layer to replace its image.
            {it.kind === 'image' ? ' Click the preview to set the focal point for crops.' : ''}
          </p>
        </>
      ) : (
        <p className="tip">No image yet.{it.pid ? <> Drop <code>{it.pid}.jpg</code> (or .png) onto the page and it attaches to this product.</> : null}</p>
      )}

      {it.kind === 'product' && (
        <div>
          <div className="label">Product</div>
          <div className="fields">
            <ProductField label="Label" value={it.fields?.eyebrow || ''} placeholder="e.g. New in" onSave={(v) => saveCopy('eyebrow', v)} onCopy={copyText} />
            <ProductField label="Description" long value={it.fields?.description || ''} placeholder="Short description for email" onSave={(v) => saveCopy('description', v)} onCopy={copyText} />
            <ProductField label="Button" value={it.fields?.cta ?? DEFAULT_CTA} placeholder="No button" onSave={(v) => saveCopy('cta', v)} onCopy={copyText} />
            {([['Price', 'price'], ['Link', 'link'], ['PID', 'pid']] as [string, string][]).map(([label, f]) => (
              <ProductField key={f} label={label} mono value={it[f] || ''} onSave={async (v) => { if (await onPatch({ [f]: v || null })) toast('Saved'); }} onCopy={copyText} />
            ))}
          </div>
          <p className="tip">Name, label, description and button are yours: a feed sync won’t overwrite them once edited. Price, link and image always follow the feed.{it.fields?.feed_description ? ' The full feed description is kept for reference.' : ''}</p>
        </div>
      )}

      <div className="fill" />
      <div className="actions">
        {confirmDel ? (
          <><span className="tip">Delete for everyone?</span><button className="btn" type="button" onClick={onDelete}>Delete</button><button className="btn quiet" type="button" onClick={() => setConfirmDel(false)}>Keep</button></>
        ) : (
          <button className="btn quiet" type="button" onClick={() => setConfirmDel(true)}>Delete asset</button>
        )}
      </div>
    </aside>
  );
}

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
