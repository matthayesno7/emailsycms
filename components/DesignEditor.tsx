'use client';
import { useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import DesignCanvas, { type StudioBrand } from './DesignCanvas';
import { assetsUsed, type Layer, type Spec } from '@/lib/design';
import { exportPng } from '@/lib/exportDesign';
import { emailRendition } from '@/lib/renditions';
import { loadImg } from '@/lib/images';
import { Icon } from './icons';
import type { Asset } from './Library';

const ROLE: Record<string, string> = { headline: 'Headline', subhead: 'Subhead', body: 'Body', eyebrow: 'Label', price: 'Price' };

// Edit mode for designs made in the Studio, right on the asset page: the design big, its
// layout live. Change the words, swap a photo or the logo, or say what to change. Saves as a
// new version of this asset (the current one is kept) or as a copy.
export default function DesignEditor({ it, supabase, wsId, brand, fonts, srcOf, library, thumbOf, onCancel, onSaved, toast }: {
  it: Asset;
  supabase: SupabaseClient;
  wsId: string;
  brand: StudioBrand;
  fonts: string[];
  srcOf: (id: string) => string | undefined;
  library: Asset[];                       // photos and products that can go into the design
  thumbOf: (a: Asset) => string | undefined;
  onCancel: () => void;
  onSaved: (newId?: string) => void;
  toast: (m: string) => void;
}) {
  const size: { w: number; h: number } = it.provenance?.size || { w: it.width || 1200, h: it.height || 600 };
  const [spec, setSpec] = useState<Spec>(it.provenance.spec);
  const [history, setHistory] = useState<Spec[]>([]);
  const [ask, setAsk] = useState('');
  const [busy, setBusy] = useState<'' | 'refine' | 'version' | 'copy' | 'png'>('');
  const [swap, setSwap] = useState<number | null>(null); // which image layer is being swapped
  const [q, setQ] = useState('');
  const changed = history.length > 0;

  const update = (next: Spec) => { setHistory((h) => [...h, spec]); setSpec(next); };
  const setLayer = (i: number, patch: Partial<Layer>) => update({ ...spec, layers: spec.layers.map((l, j) => (j === i ? ({ ...l, ...patch } as Layer) : l)) });
  const undo = () => { const prev = history[history.length - 1]; if (prev) { setSpec(prev); setHistory((h) => h.slice(0, -1)); } };

  async function refine(e: React.FormEvent) {
    e.preventDefault();
    const instruction = ask.trim();
    if (!instruction) return;
    setBusy('refine');
    try {
      const r = await fetch('/api/design', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace_id: wsId, brief: it.provenance?.prompt || it.name, size, base: spec, instruction }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.spec) throw new Error(j.error || 'Couldn’t make that change.');
      update(j.spec); setAsk('');
    } catch (err: any) { toast(err?.message || 'Couldn’t make that change.'); }
    setBusy('');
  }

  // Render the design to a PNG, upload it with its email-ready copy.
  async function file() {
    const blob = await exportPng({ spec, size, brand, srcOf, fonts });
    const path = `${wsId}/generated/${crypto.randomUUID()}.png`;
    const up = await supabase.storage.from('assets').upload(path, blob, { contentType: 'image/png' });
    if (up.error) throw up.error;
    let email: any = null;
    const url = URL.createObjectURL(blob);
    try { email = await emailRendition(supabase, wsId, await loadImg(url), { mime: 'image/png', bytes: blob.size }); } catch {} finally { URL.revokeObjectURL(url); }
    return { storage_path: path, mime: 'image/png', width: size.w, height: size.h, bytes: blob.size, images: email ? { email } : {} };
  }
  const alt = () => spec.layers.filter((l) => l.type === 'text').map((l: any) => l.text).join('. ').slice(0, 150);
  const provenance = () => ({ ...(it.provenance || {}), spec, size, source_asset_ids: assetsUsed(spec), edited_at: new Date().toISOString() });

  async function saveVersion() {
    setBusy('version');
    try {
      const f = await file();
      const { error } = await supabase.rpc('asset_new_version', { p_asset: it.id, p_file: f, p_note: 'Edited the design', p_provenance: provenance() });
      if (error) throw error;
      await supabase.from('assets').update({ fields: { ...(it.fields || {}), alt: alt() } }).eq('id', it.id);
      toast(`Saved as version ${(it.version || 1) + 1}. The previous version is kept.`);
      onSaved();
    } catch (err: any) { toast(`Couldn’t save${err?.message ? `: ${err.message}` : ''}`); setBusy(''); }
  }
  async function saveCopy() {
    setBusy('copy');
    try {
      const f = await file();
      const { data, error } = await supabase.from('assets').insert({
        workspace_id: wsId, kind: 'image', name: `${spec.name || it.name} (copy)`.slice(0, 120), ...f, folder_id: it.folder_id || null,
        origin: 'generated', status: 'approved', fields: { alt: alt() },
        provenance: { ...provenance(), copied_from: it.id, generated_at: new Date().toISOString() },
      }).select('id').single();
      if (error) throw error;
      toast('Saved as a new design. The original is unchanged.');
      onSaved(data.id);
    } catch (err: any) { toast(`Couldn’t save${err?.message ? `: ${err.message}` : ''}`); setBusy(''); }
  }
  async function png() {
    setBusy('png');
    try {
      const blob = await exportPng({ spec, size, brand, srcOf, fonts });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `${(spec.name || it.name).replace(/[^\w-]+/g, '-').toLowerCase()}-${size.w}x${size.h}.png`;
      document.body.appendChild(a); a.click(); a.remove();
    } catch (err: any) { toast(err?.message || 'Couldn’t export.'); }
    setBusy('');
  }

  const pickable = useMemo(() => {
    const s = q.trim().toLowerCase();
    return library.filter((a) => a.id !== it.id && (!s || `${a.name} ${(a.tags || []).join(' ')} ${a.description || ''}`.toLowerCase().includes(s))).slice(0, 60);
  }, [library, q, it.id]);
  const wide = size.w / size.h;

  return (
    <div className="ed-body editing design-edit">
      <section className="ed-canvas" aria-label="Design">
        {fonts.map((u) => <link key={u} rel="stylesheet" href={u} />)}
        <div className="ed-tools">
          <button type="button" className="btn quiet" onClick={undo} disabled={!history.length || !!busy}>↶ Undo</button>
          <span className="spacer" />
          <span className="ie-out">{size.w}×{size.h} · PNG</span>
        </div>
        <div className="ed-stage de-stage">
          <div className="de-fit" style={wide >= 1 ? { width: `min(100%, calc((100vh - 220px) * ${wide}))` } : { height: 'calc(100vh - 220px)', aspectRatio: `${wide}` }}>
            <div className={'de-canvas' + (busy === 'refine' ? ' busy' : '')} style={{ position: 'relative' }}>
              <DesignCanvas spec={spec} size={size} brand={brand} srcOf={srcOf} editable={!busy} onText={(i, t) => { const l = spec.layers[i]; if (l && (l.type === 'text' || l.type === 'button') && t && t !== l.text) setLayer(i, { text: t } as any); }} />
            </div>
          </div>
          <span className="hint">Double-click any text on the design to change it</span>
        </div>
      </section>

      <aside className="ed-side ie-side" aria-label="Edit the design">
        <div className="ie-scroll">
          <div className="ed-sec">
            <div className="label">Words</div>
            {spec.layers.map((l, i) => (l.type === 'text' || l.type === 'button') ? (
              <label key={i} className="de-field">
                <span>{l.type === 'button' ? 'Button' : ROLE[l.role] || 'Text'}</span>
                {l.type === 'text' && l.text.length > 40
                  ? <textarea className="in" rows={2} defaultValue={l.text} key={l.text} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== l.text && setLayer(i, { text: e.target.value.trim() } as any)} />
                  : <input className="in" defaultValue={l.text} key={l.text} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== l.text && setLayer(i, { text: e.target.value.trim() } as any)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />}
              </label>
            ) : null)}
          </div>

          {spec.layers.some((l) => l.type === 'image' || l.type === 'logo') && (
            <div className="ed-sec">
              <div className="label">Images</div>
              {spec.layers.map((l, i) => l.type === 'image' ? (
                <div key={i} className="de-img">
                  <span className="vthumb">{srcOf(l.asset) ? <img src={srcOf(l.asset)} alt="" /> : null}</span>
                  <span className="vmeta"><b>{library.find((a) => a.id === l.asset)?.name || 'Photo'}</b><small>{l.fit === 'contain' ? 'Cut-out' : 'Photo'}</small></span>
                  <button type="button" className="btn quiet" onClick={() => { setSwap(swap === i ? null : i); setQ(''); }}>{swap === i ? 'Close' : 'Swap'}</button>
                </div>
              ) : l.type === 'logo' ? (
                <div key={i} className="de-img">
                  <span className="vthumb logo">{(l.variant === 'reversed' ? brand.logoReversed : brand.logo) ? <img src={l.variant === 'reversed' ? brand.logoReversed : brand.logo} alt="" /> : 'Logo'}</span>
                  <span className="vmeta"><b>Logo</b><small>{l.variant === 'reversed' ? 'Reversed, for dark backgrounds' : 'Primary'}</small></span>
                  <button type="button" className="btn quiet" onClick={() => setLayer(i, { variant: l.variant === 'reversed' ? 'primary' : 'reversed' } as any)}>Use {l.variant === 'reversed' ? 'primary' : 'reversed'}</button>
                </div>
              ) : null)}
              {swap !== null && (
                <div className="de-picker">
                  <input className="in" placeholder="Search photos and products" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
                  <div className="de-grid">
                    {pickable.map((a) => (
                      <button key={a.id} type="button" title={a.name} onClick={() => { const l = spec.layers[swap] as any; setLayer(swap, { asset: a.id, fit: a.kind === 'product' && l.fit === 'contain' ? 'contain' : l.fit, focus: a.focus || undefined } as any); setSwap(null); }}>
                        {thumbOf(a) ? <img src={thumbOf(a)} alt={a.name} loading="lazy" /> : <span>{a.name}</span>}
                      </button>
                    ))}
                    {!pickable.length && <p className="tip">Nothing matches.</p>}
                  </div>
                </div>
              )}
            </div>
          )}

          <form className="ed-sec" onSubmit={refine}>
            <div className="label">Change it with words</div>
            <textarea className="in" rows={2} value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="“Darker”, “bigger headline”, “move the text left”, “add 20% off”"
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement).requestSubmit(); } }} />
            <button className="btn" type="submit" disabled={!ask.trim() || !!busy}><Icon.Sparkle size={15} />{busy === 'refine' ? 'Changing…' : 'Change'}</button>
          </form>
        </div>
        <div className="ie-save">
          <p className="tip">{changed ? 'The current version is kept in the history.' : 'Make a change to save it.'}</p>
          <div className="ie-row">
            <button className="btn" type="button" disabled={!!busy || !changed} onClick={saveCopy}>{busy === 'copy' ? 'Saving…' : 'Save as copy'}</button>
            <button className="primary grow" type="button" disabled={!!busy || !changed} onClick={saveVersion}>{busy === 'version' ? 'Saving…' : `Save as version ${(it.version || 1) + 1}`}</button>
          </div>
          <div className="ie-row links">
            <button className="linkish" type="button" onClick={onCancel} disabled={busy === 'version' || busy === 'copy'}>Cancel</button>
            <button className="linkish" type="button" onClick={png} disabled={!!busy}>{busy === 'png' ? 'Exporting…' : 'Download PNG'}</button>
          </div>
        </div>
      </aside>
    </div>
  );
}
