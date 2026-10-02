'use client';
import { useEffect, useState } from 'react';
import type { Asset } from './Library';

// The "About" panel in the asset editor: what auto-organise found, editable.
// Anything a person changes is marked as edited, so the AI never overwrites it.
export default function AssetAbout({ it, onPatch, toast, product, suggested, onOpenProduct, onRetag, duplicate, onOpenDuplicate, onDelete }: {
  it: Asset;
  onPatch: (p: Record<string, any>) => Promise<boolean>;
  toast: (m: string) => void;
  product?: { id: string; name: string } | null;      // linked product
  suggested?: { id: string; name: string } | null;    // a product the AI thinks it might be
  onOpenProduct?: (id: string) => void;
  onRetag?: () => void;
  duplicate?: { id: string; name: string } | null;
  onOpenDuplicate?: (id: string) => void;
  onDelete?: () => void;
}) {
  const [desc, setDesc] = useState(it.description || '');
  const [tag, setTag] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  useEffect(() => setDesc(it.description || ''), [it.description]);
  const tags: string[] = it.tags || [];
  const edited = new Set<string>(it.edited || []);
  const mark = (k: string) => Array.from(new Set([...(it.edited || []), k]));

  async function saveDesc() {
    const v = desc.trim();
    if (v === (it.description || '')) return;
    if (await onPatch({ description: v || null, edited: mark('description') })) toast('Saved');
  }
  async function setTags(next: string[]) {
    await onPatch({ tags: next, edited: mark('tags') });
  }
  function addTag(e: React.FormEvent) {
    e.preventDefault();
    const add = tag.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
    setTag('');
    if (add.length) setTags([...new Set([...tags, ...add])].slice(0, 30));
  }

  const status = it.ai_status as string | null;
  const brand: any[] = it.ai?.brand_colours || (it.colours || []).map((hex: string) => ({ hex }));
  const isVisual = ['image', 'logo', 'product'].includes(it.kind);

  return (
    <div className="ed-sec about">
      <div className="label about-h">About
        <span className="ai-state">
          {status === 'pending' || status === 'processing' ? 'Organising…'
            : status === 'failed' ? <>Couldn’t organise{it.ai_error ? `: ${it.ai_error}` : ''}{onRetag && <> · <button type="button" className="linkish" onClick={onRetag}>Try again</button></>}</>
            : status === 'done' ? <>Organised by AI{onRetag && <> · <button type="button" className="linkish" onClick={onRetag} title="Your edits are kept">Redo</button></>}</>
            : status === 'skipped' ? 'Tagged from its name'
            : isVisual && onRetag ? <button type="button" className="linkish" onClick={onRetag}>Organise with AI</button> : null}
        </span>
      </div>

      {duplicate && !it.duplicate_ok && (
        <div className="dup-box">
          <b>Looks like a copy of “{duplicate.name}”</b>
          <div className="row">
            <button type="button" className="btn" onClick={() => onOpenDuplicate?.(duplicate.id)}>Open it</button>
            <button type="button" className="btn" onClick={async () => { if (await onPatch({ duplicate_ok: true })) toast('Kept both'); }}>Keep both</button>
            {onDelete && (confirmDel
              ? <><button type="button" className="btn" onClick={onDelete}>Delete for everyone</button><button type="button" className="btn quiet" onClick={() => setConfirmDel(false)}>Cancel</button></>
              : <button type="button" className="btn quiet" onClick={() => setConfirmDel(true)}>Delete this copy</button>)}
          </div>
        </div>
      )}

      <textarea className="in about-desc" rows={3} maxLength={400} value={desc} placeholder={status === 'pending' || status === 'processing' ? 'Writing a description…' : 'Describe what’s in it, so people can find it'}
        aria-label="Description" onChange={(e) => setDesc(e.target.value)} onBlur={saveDesc} />

      <div className="tagrow" aria-label="Tags">
        {tags.map((t) => (
          <span key={t} className="tagchip">{t}<button type="button" aria-label={`Remove ${t}`} onClick={() => setTags(tags.filter((x) => x !== t))}>×</button></span>
        ))}
        <form onSubmit={addTag} className="tagadd"><input className="in" value={tag} placeholder="Add tag" aria-label="Add a tag" onChange={(e) => setTag(e.target.value)} onBlur={(e) => tag.trim() && addTag(e as any)} /></form>
      </div>
      {(edited.has('tags') || edited.has('description')) && <p className="tip">Your edits are kept when AI runs again.</p>}

      {brand.length > 0 && (
        <div className="swatches" aria-label="Colours">
          {brand.map((c: any) => (
            <button key={c.hex} type="button" className="sw" title={c.label ? `${c.hex} · close to brand ${c.label} (${c.brand_hex})` : c.hex} onClick={async () => { try { await navigator.clipboard.writeText(c.hex); toast(`Copied ${c.hex}`); } catch {} }}>
              <i style={{ background: c.hex }} />{c.label ? <span>{c.label}</span> : <span className="mono">{c.hex}</span>}
            </button>
          ))}
        </div>
      )}

      {typeof it.on_brand === 'boolean' && (
        <p className={'brandcheck ' + (it.on_brand ? 'ok' : 'off')}><b>{it.on_brand ? 'On brand' : 'Off brand'}</b>{it.on_brand_reason ? ` · ${it.on_brand_reason}` : ''}</p>
      )}

      {it.text_in_image && (
        <div className="field ocr"><span className="k">Text</span><span className="v" title={it.text_in_image}>{it.text_in_image}</span>
          <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(it.text_in_image); toast('Copied'); } catch {} }}>Copy</button></div>
      )}

      {it.kind !== 'product' && (product ? (
        <p className="tip">Shows <button type="button" className="linkish" onClick={() => onOpenProduct?.(product.id)}>{product.name}</button> · <button type="button" className="linkish" onClick={async () => { if (await onPatch({ product_id: null, edited: mark('product') })) toast('Unlinked'); }}>Not this product</button></p>
      ) : suggested && !edited.has('product') ? (
        <p className="tip">Is this <b>{suggested.name}</b>? <button type="button" className="linkish" onClick={async () => { if (await onPatch({ product_id: suggested.id, edited: mark('product') })) toast('Linked to the product'); }}>Yes, link it</button> · <button type="button" className="linkish" onClick={() => onPatch({ edited: mark('product') })}>No</button></p>
      ) : null)}
    </div>
  );
}
