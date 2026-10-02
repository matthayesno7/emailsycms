'use client';
import { useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_CTA } from '@/lib/products';
import { loadImg } from '@/lib/images';
import { exportAs, type TeamPreset } from '@/lib/imageEdit';
import type { BrandKit } from '@/lib/brandKit';
import { Icon } from './icons';
import AssetAbout from './AssetAbout';
import AssetVersions from './AssetVersions';
import ImageEditor, { type EditResult } from './ImageEditor';
import type { Asset } from './Library';

const TYPES: [string, string][] = [['image', 'Image'], ['logo', 'Logo'], ['product', 'Product']];
const VIDEO_TYPES: [string, string][] = [['video', 'Video']];
type Focus = { x: number; y: number };
const SIZES: [string, string, number | null][] = [['original', 'Original size', null], ['web', 'Web, 2000px', 2000], ['email', 'Email-ready, 1200px', 1200]];

// The asset page: one image, logo, product image or video, with everything about it on the right.
// Opens at ?asset=<id>, so it has its own link and Back works.
// Two ways to change it: Edit (hands-on, free, saves a new version; Studio designs reopen in the
// Studio with their layout live) and AI edit (prompt-led, coming next).
export default function AssetEditor({ it, src, usedIn = [], onOpenBlock, onClose, onPatch, onDelete, onMakeBlock, onPrev, onNext, position, toast, folders = [], onShare, onEmailCopy, figmaUrl, product, suggested, duplicate, onOpenAsset, onRetag, supabase, kit, onSaveEdit, onRevert, onEditDesign, onAddPreset }: {
  it: Asset;
  folders?: { id: string; name: string }[];
  onShare?: () => Promise<string | null>;
  onEmailCopy?: () => void; // download the email-ready version
  figmaUrl?: string | null;
  product?: { id: string; name: string } | null;
  suggested?: { id: string; name: string } | null;
  duplicate?: { id: string; name: string } | null;
  onOpenAsset?: (id: string) => void;
  onRetag?: () => void;
  supabase?: SupabaseClient;
  kit?: BrandKit | null;
  onSaveEdit?: (r: EditResult, asCopy: boolean) => Promise<boolean>;
  onRevert?: (version: number) => Promise<boolean>;
  onEditDesign?: () => void; // Studio designs: reopen in the Studio
  onAddPreset?: (p: TeamPreset) => Promise<boolean>;
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
  const [editing, setEditing] = useState(false);
  const [zoom, setZoom] = useState<'fit' | '1x'>('fit');
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [focus, setFocus] = useState<Focus>(it.focus || { x: 0.5, y: 0.5 });
  const [dlOpen, setDlOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [name, setName] = useState(it.name);
  const imgCache = useRef<{ src?: string; img?: HTMLImageElement }>({});

  useEffect(() => setName(it.name), [it.name]);
  useEffect(() => setFocus(it.focus || { x: 0.5, y: 0.5 }), [it.focus]);
  useEffect(() => setEditing(false), [it.id, it.version]);
  // Esc while editing leaves edit mode (and doesn't close the page underneath).
  useEffect(() => {
    if (!editing) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); } };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [editing]);

  const isVideo = it.kind === 'video';
  const isSvg = /svg/.test(it.mime || '');
  const isDesign = it.provenance?.via === 'studio' && !!it.provenance?.spec;
  const canEdit = !!src && !isVideo && !isSvg && (isDesign ? !!onEditDesign : !!onSaveEdit);

  // Keyboard: arrows move between assets (outside text fields and edit mode).
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (editing || /INPUT|TEXTAREA|SELECT/.test((document.activeElement as HTMLElement)?.tagName)) return;
      if (e.key === 'ArrowLeft' && onPrev) { e.preventDefault(); onPrev(); }
      if (e.key === 'ArrowRight' && onNext) { e.preventDefault(); onNext(); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onPrev, onNext, editing]);

  async function image() {
    if (!src) throw new Error('No image');
    if (imgCache.current.src !== src) imgCache.current = { src, img: await loadImg(src) };
    return imgCache.current.img!;
  }
  const base = () => (it.pid || it.name).replace(/[^\w.-]+/g, '-').toLowerCase();

  async function download(format: 'jpg' | 'png' | 'webp' | 'orig', maxW: number | null) {
    setDlOpen(false);
    try {
      if (format === 'orig' || isSvg) { if (src) { const a = document.createElement('a'); a.href = src; a.download = base(); a.target = '_blank'; a.click(); } return; }
      const blob = await exportAs(await image(), format, maxW);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `${base()}${maxW ? `-${maxW}` : ''}.${blob.type.includes('png') && format !== 'png' ? 'png' : format}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch { toast('Couldn’t prepare the download.'); }
  }
  async function copyImage() {
    try {
      const blob = await exportAs(await image(), 'png', null);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('Copied. Paste it into Figma.');
    } catch { toast('Your browser blocked copying images. Use Download instead.'); }
  }

  const pointAt = (e: React.PointerEvent<HTMLElement>): Focus => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  async function setFocal(f: Focus) {
    setFocus(f);
    if (await onPatch({ focus: { x: Math.round(f.x * 1000) / 1000, y: Math.round(f.y * 1000) / 1000 } })) toast('Focal point saved');
  }

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
  const copyText = async (v?: string) => { if (!v) return; try { await navigator.clipboard.writeText(v); toast('Copied'); } catch { toast(v); } };

  const w = natural?.w || it.width, h = natural?.h || it.height;
  const info = [w && `${w}×${h}`, it.bytes && `${Math.round(it.bytes / 1024)} KB`, it.mime?.split('/')[1]?.toUpperCase().replace('SVG+XML', 'SVG'), (it.version || 1) > 1 && `version ${it.version}`].filter(Boolean).join(' · ');

  return (
    <div className="editor" role="dialog" aria-modal="true" aria-label={`${editing ? 'Editing' : 'Asset'} ${it.name}`}>
      <header className="ed-bar">
        <button className="ghost" type="button" onClick={editing ? () => setEditing(false) : onClose} title={editing ? 'Stop editing' : 'Back to the library (Esc)'}><Icon.Back />{editing ? 'Done' : 'Library'}</button>
        <div className="ed-title">
          <input className="title-in" value={name} maxLength={120} aria-label="Asset name" title="Rename"
            onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
          <div className="sub">{editing ? `Editing · saves as version ${(it.version || 1) + 1}, the original is kept` : info || 'No image yet'}</div>
        </div>
        <span className="spacer" />
        {!editing && (onPrev || onNext) && (
          <div className="ed-nav">
            <button className="x" type="button" aria-label="Previous asset" disabled={!onPrev} onClick={onPrev}><Icon.Chevron /></button>
            {position && <span>{position}</span>}
            <button className="x" type="button" aria-label="Next asset" disabled={!onNext} onClick={onNext}><Icon.Chevron /></button>
          </div>
        )}
        {!editing && src && (
          <div className="modes" role="group" aria-label="Change this asset">
            {canEdit && <button className="btn" type="button" onClick={() => (isDesign ? onEditDesign!() : setEditing(true))} title={isDesign ? 'Opens in the Studio with the layout live: change copy, swap images, or change it with words' : 'Crop, resize, rotate and adjust'}><Icon.Palette size={15} />Edit</button>}
            {!isVideo && <button className="btn" type="button" disabled title="Remove backgrounds, extend, upscale and change it with words. Coming next."><Icon.Sparkle size={15} />AI edit <em className="soon">Soon</em></button>}
          </div>
        )}
        {!editing && src && isVideo && <a className="btn" href={src} download={`${it.name.replace(/[^\w.-]+/g, '-')}.mp4`} target="_blank" rel="noreferrer">Download</a>}
        {!editing && src && !isVideo && (
          <div className="dlwrap">
            <button className="btn" type="button" aria-expanded={dlOpen} onClick={() => setDlOpen((o) => !o)}><Icon.Download size={15} />Download</button>
            {dlOpen && (
              <>
                <div className="clickaway" onClick={() => setDlOpen(false)} />
                <div className="dlmenu" role="menu">
                  <button type="button" role="menuitem" onClick={() => download('orig', null)}><b>Original file</b><small>{it.mime?.split('/')[1]?.toUpperCase().replace('SVG+XML', 'SVG')}{w ? ` · ${w}×${h}` : ''}</small></button>
                  {!isSvg && SIZES.filter(([, , mw]) => !mw || (w || 0) > mw).map(([k, label, mw]) => (
                    <div key={k} className="dlrow"><span>{label}</span>{(['jpg', 'png', 'webp'] as const).map((f) => <button key={f} type="button" role="menuitem" onClick={() => download(f, mw)}>{f.toUpperCase()}</button>)}</div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        {!editing && src && !isVideo && !isSvg && <button className="primary" type="button" onClick={copyImage}>Copy image</button>}
      </header>

      {editing && src && onSaveEdit ? (
        <ImageEditor it={it} src={src} kit={kit || null} toast={toast} onAddPreset={onAddPreset}
          onCancel={() => setEditing(false)}
          onSave={async (r, asCopy) => { const ok = await onSaveEdit(r, asCopy); if (ok) setEditing(false); return ok; }} />
      ) : (
        <div className="ed-body">
          <section className="ed-canvas" aria-label="Canvas">
            <div className="ed-tools">
              {it.kind === 'image' && src && !isVideo && <span className="tip">Click the picture to set its focal point: Mise keeps it in view whenever it crops this image.</span>}
              <span className="spacer" />
              {!isVideo && src && (
                <div className="seg" role="group" aria-label="Zoom">
                  <button type="button" aria-pressed={zoom === 'fit'} onClick={() => setZoom('fit')}>Fit</button>
                  <button type="button" aria-pressed={zoom === '1x'} onClick={() => setZoom('1x')}>100%</button>
                </div>
              )}
            </div>
            <div className={'ed-stage' + (zoom === '1x' ? ' actual' : '') + (it.kind !== 'image' ? ' light' : '')}>
              {isVideo && src ? (
                <video className="ed-out" src={src} controls playsInline autoPlay muted loop />
              ) : !src ? (
                <p className="tip">No image yet.{it.pid ? <> Drop <code>{it.pid}.jpg</code> (or .png) onto the library and it attaches to this product.</> : null}</p>
              ) : (
                <div className="ed-view">
                  <img className="ed-out" src={src} alt={it.fields?.alt || it.name} draggable data-drag={base()} data-png={/png/.test(it.mime || '') ? '1' : '0'}
                    onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                    onPointerUp={(e) => { if (it.kind === 'image') setFocal(pointAt(e)); }} />
                  {it.kind === 'image' && it.focus && <i className="ed-focus" style={{ left: `${focus.x * 100}%`, top: `${focus.y * 100}%` }} />}
                </div>
              )}
              {src && !isVideo && <span className="hint">Drag into Figma, or copy and press <kbd>⌘</kbd> <kbd>⇧</kbd> <kbd>R</kbd> on a selected layer to replace its image</span>}
            </div>
          </section>

          <aside className="ed-side" aria-label="Details">
            {it.origin === 'generated' && (
              <div className={'origin-box' + (it.status === 'draft' ? ' draft' : '')}>
                <div className="bl"><b>{it.status === 'draft' ? 'Generated · waiting for approval' : 'Generated · approved'}</b>
                  {it.status === 'draft' && <button className="primary" type="button" onClick={async () => { if (await onPatch({ status: 'approved' })) toast('Approved'); }}>Approve</button>}
                </div>
                {it.provenance?.prompt && <p className="tip">“{it.provenance.prompt}”</p>}
                <p className="tip">{[it.provenance?.model, it.provenance?.style, it.provenance?.source_product_pid && `from product ${it.provenance.source_product_pid}`, it.provenance?.brand_kit_version && `brand kit v${it.provenance.brand_kit_version}`].filter(Boolean).join(' · ')}</p>
                {isDesign && onEditDesign && <p className="tip">Made in the Studio: <button type="button" className="linkish" onClick={onEditDesign}>edit it with the layout live</button>.</p>}
              </div>
            )}

            {!isVideo && (
              <AssetAbout it={it} onPatch={onPatch} toast={toast} product={product} suggested={suggested} onOpenProduct={onOpenAsset}
                onRetag={onRetag} duplicate={duplicate} onOpenDuplicate={onOpenAsset} onDelete={onDelete} />
            )}

            {supabase && onRevert && <AssetVersions it={it} supabase={supabase} onRevert={onRevert} toast={toast} />}

            <div className="ed-sec">
              <div className="label">Send to</div>
              <div className="sendto">
                <button type="button" disabled title="Coming soon"><Icon.Bag /><span><b>Shopify product <em className="soon">Soon</em></b><small>Add it to a product’s images</small></span></button>
                {!isVideo && onEmailCopy && <button type="button" onClick={onEmailCopy}><Icon.Mail /><span><b>Email</b><small>{it.images?.email ? `Email-ready, ${it.images.email.width}px, ${Math.round(it.images.email.bytes / 1024)} KB` : 'Download for Klaviyo, Mailchimp…'}</small></span></button>}
                <button type="button" onClick={async () => {
                  const prompt = `Put my Mise ${isVideo ? 'video' : 'image'} "${it.name}" (asset id ${it.id}) into my Figma file${figmaUrl ? ` ${figmaUrl}` : ''}.`;
                  try { await navigator.clipboard.writeText(prompt); } catch {}
                  window.open(`https://claude.ai/new?q=${encodeURIComponent(prompt)}`, '_blank', 'noopener');
                }}><Icon.Send /><span><b>Figma</b><small>Claude places it full size, or drag the image in</small></span></button>
                {onShare && <button type="button" onClick={async () => { const u = await onShare(); if (u) { try { await navigator.clipboard.writeText(u); toast('Link copied.'); } catch { toast(u); } } }}><Icon.Share /><span><b>Share link</b><small>Expiry, passcode, download counts</small></span></button>}
              </div>
            </div>

            {folders.length > 0 && (
              <div className="ed-sec">
                <div className="label">Folder</div>
                <select className="in" value={it.folder_id || ''} onChange={async (e) => { if (await onPatch({ folder_id: e.target.value || null })) toast('Moved'); }}>
                  <option value="">No folder</option>
                  {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
            )}

            <div className="ed-sec">
              <div className="label">Type</div>
              <div className="seg" role="group" aria-label="Asset type">
                {(isVideo ? VIDEO_TYPES : TYPES).map(([k, l]) => <button key={k} type="button" aria-pressed={it.kind === k} onClick={() => setKind(k)}>{l}</button>)}
              </div>
            </div>

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
            {it.provenance?.via === 'edit' && it.provenance?.source_asset_id && <p className="tip">An edited copy{it.provenance.note ? ` (${it.provenance.note.toLowerCase()})` : ''}. <button type="button" className="linkish" onClick={() => onOpenAsset?.(it.provenance.source_asset_id)}>Open the original</button></p>}

            <div className="fill" />
            <div className="actions">
              {confirmDel ? (
                <><span className="tip">Delete for everyone, with all its versions?</span><button className="btn" type="button" onClick={onDelete}>Delete</button><button className="btn quiet" type="button" onClick={() => setConfirmDel(false)}>Keep</button></>
              ) : (
                <button className="btn quiet" type="button" onClick={() => setConfirmDel(true)}>Delete asset</button>
              )}
            </div>
          </aside>
        </div>
      )}
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
