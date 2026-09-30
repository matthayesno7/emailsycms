'use client';
import { useEffect, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FORMATS, assetsUsed, type Spec } from '@/lib/design';
import { exportPng } from '@/lib/exportDesign';
import { emailRendition } from '@/lib/renditions';
import { loadImg } from '@/lib/images';
import DesignCanvas, { type StudioBrand } from './DesignCanvas';
import { Icon } from './icons';
import type { Ws } from './Library';

export type Variant = {
  key: string;
  size: { w: number; h: number };
  status: 'loading' | 'ready' | 'refining' | 'error';
  spec?: Spec;
  history: Spec[];
  error?: string;
  savedId?: string;
  busy?: 'saving' | 'download' | 'figma';
  label?: string; // e.g. the format name for resized versions
};

const STAGES = ['Reading your brand kit', 'Choosing the photo', 'Writing the headline', 'Laying it out', 'Checking it reads', 'Adding the finishing touches'];

// Picks the canvas from what someone typed, when they didn't choose a format.
export function formatFor(brief: string): { w: number; h: number } {
  const id = formatId(brief);
  const f = FORMATS.find((x) => x.id === id)!;
  return { w: f.w, h: f.h };
}
function formatId(brief: string) {
  const b = brief.toLowerCase();
  if (/linkedin/.test(b) && /banner|cover|header/.test(b)) return 'linkedin-banner';
  if (/linkedin/.test(b)) return 'linkedin-post';
  if (/stor(y|ies)|tiktok|reel/.test(b)) return 'story';
  if (/instagram|insta|\big\b|feed post/.test(b)) return 'ig-post';
  if (/square|facebook|meta|\bad\b|ads\b/.test(b)) return 'square';
  return 'email-hero';
}

let seq = 0;
const key = () => `v${++seq}`;

export default function Studio({ ws, userId, supabase, brand, fonts, srcOf, brief, size, initial, onBrief, onClose, onSaved, onOpenAsset, toast }: {
  ws: Ws; userId: string; supabase: SupabaseClient; brand: StudioBrand; fonts: string[];
  srcOf: (id: string) => string | undefined;
  brief: string; size: { w: number; h: number };
  initial?: Variant[]; // for previews and tests: skip designing and show these
  onBrief: (brief: string, size: { w: number; h: number }) => void;
  onClose: () => void; onSaved: () => void; onOpenAsset: (id: string) => void; toast: (m: string) => void;
}) {
  const [variants, setVariants] = useState<Variant[]>(initial || []);
  const [sel, setSel] = useState<string | null>(null);
  const [ask, setAsk] = useState('');
  const [stage, setStage] = useState(0);
  const [edit, setEdit] = useState(brief);
  const refineBox = useRef<HTMLInputElement>(null);
  const run = useRef(0);
  const format = FORMATS.find((f) => f.w === size.w && f.h === size.h) || { id: 'custom', label: 'Custom', w: size.w, h: size.h, hint: '' };

  const patch = (k: string, p: Partial<Variant> | ((v: Variant) => Partial<Variant>)) =>
    setVariants((list) => list.map((v) => (v.key === k ? { ...v, ...(typeof p === 'function' ? p(v) : p) } : v)));

  async function call(body: Record<string, any>): Promise<{ spec?: Spec; error?: string }> {
    try {
      const res = await fetch('/api/design', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace_id: ws.id, brief, ...body }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return { error: json.error || 'Something went wrong.' };
      return { spec: json.spec };
    } catch { return { error: 'Couldn’t reach Emailsy.' }; }
  }

  // New brief or format: three directions, designed in parallel, each shown as soon as it's ready.
  useEffect(() => {
    if (initial) return;
    const id = ++run.current;
    const fresh: Variant[] = [0, 1, 2].map(() => ({ key: key(), size, status: 'loading', history: [] }));
    setVariants(fresh); setSel(null); setEdit(brief);
    fresh.forEach(async (v, i) => {
      const r = await call({ size, variant: i });
      if (run.current !== id) return;
      patch(v.key, r.spec ? { status: 'ready', spec: r.spec } : { status: 'error', error: r.error });
    });
  }, [brief, size.w, size.h]); // eslint-disable-line react-hooks/exhaustive-deps

  const loading = variants.some((v) => v.status === 'loading' || v.status === 'refining');
  useEffect(() => {
    if (!loading) return;
    setStage(0);
    const t = setInterval(() => setStage((s) => Math.min(STAGES.length - 1, s + 1)), 1600);
    return () => clearInterval(t);
  }, [loading]);

  const selected = variants.find((v) => v.key === sel) || null;

  async function refine(e?: React.FormEvent) {
    e?.preventDefault();
    const instruction = ask.trim();
    const target = selected || variants.find((v) => v.status === 'ready');
    if (!instruction || !target?.spec) return;
    setAsk('');
    setSel(target.key);
    const base = target.spec;
    patch(target.key, { status: 'refining' });
    const r = await call({ size: target.size, base, instruction });
    patch(target.key, (v) => (r.spec ? { status: 'ready', spec: r.spec, history: [...v.history, base], savedId: undefined } : { status: 'ready', error: undefined }));
    if (!r.spec) toast(r.error || 'Couldn’t make that change.');
  }

  function undo(v: Variant) {
    const prev = v.history[v.history.length - 1];
    if (prev) patch(v.key, { spec: prev, history: v.history.slice(0, -1), savedId: undefined });
  }

  // One design, every size: adapt it to each other format.
  function everySize(v: Variant) {
    if (!v.spec) return;
    const others = FORMATS.filter((f) => !f.video && !(f.w === v.size.w && f.h === v.size.h));
    const made: Variant[] = others.map((f) => ({ key: key(), size: { w: f.w, h: f.h }, status: 'loading', history: [], label: f.label }));
    setVariants((list) => { const at = list.findIndex((x) => x.key === v.key); const next = [...list]; next.splice(at + 1, 0, ...made); return next; });
    made.forEach(async (m) => {
      const r = await call({ size: m.size, base: v.spec });
      patch(m.key, r.spec ? { status: 'ready', spec: r.spec } : { status: 'error', error: r.error });
    });
    toast(`Making ${others.length} more sizes…`);
  }

  const png = (v: Variant) => exportPng({ spec: v.spec!, size: v.size, brand, srcOf, fonts });

  async function save(v: Variant): Promise<string | null> {
    if (!v.spec) return null;
    if (v.savedId) return v.savedId;
    patch(v.key, { busy: 'saving' });
    try {
      const blob = await png(v);
      const path = `${ws.id}/generated/${crypto.randomUUID()}.png`;
      const up = await supabase.storage.from('assets').upload(path, blob, { contentType: 'image/png' });
      if (up.error) throw up.error;
      const url = URL.createObjectURL(blob);
      let email: any = null;
      try { const img = await loadImg(url); email = await emailRendition(supabase, ws.id, img, { mime: 'image/png', bytes: blob.size }); } catch {} finally { URL.revokeObjectURL(url); }
      const { data, error } = await supabase.from('assets').insert({
        workspace_id: ws.id, kind: 'image', name: v.spec.name, storage_path: path, mime: 'image/png', bytes: blob.size, width: v.size.w, height: v.size.h,
        images: email ? { email } : {}, origin: 'generated', status: 'approved', created_by: userId,
        fields: { alt: v.spec.layers.filter((l) => l.type === 'text').map((l: any) => l.text).join('. ').slice(0, 150) },
        provenance: { via: 'studio', prompt: brief, model: 'Emailsy Studio (Claude)', spec: v.spec, size: v.size, source_asset_ids: assetsUsed(v.spec), generated_at: new Date().toISOString() },
      }).select('id').single();
      if (error) throw error;
      patch(v.key, { savedId: data.id, busy: undefined });
      onSaved();
      toast('Saved to your library');
      return data.id as string;
    } catch (err: any) {
      patch(v.key, { busy: undefined });
      toast(`Couldn’t save${err?.message ? `: ${err.message}` : ''}`);
      return null;
    }
  }

  async function download(v: Variant) {
    if (!v.spec) return;
    patch(v.key, { busy: 'download' });
    try {
      const blob = await png(v);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `${v.spec.name.replace(/[^\w-]+/g, '-').toLowerCase()}-${v.size.w}x${v.size.h}.png`;
      document.body.appendChild(a); a.click(); a.remove();
    } catch (err: any) { toast(err?.message || 'Couldn’t export.'); }
    patch(v.key, { busy: undefined });
  }

  async function toFigma(v: Variant) {
    patch(v.key, { busy: 'figma' });
    const id = await save(v);
    patch(v.key, { busy: undefined });
    if (!id) return;
    const prompt = `Rebuild my Emailsy design "${v.spec!.name}" (asset id ${id}) in Figma as editable layers${ws.figma_file_url ? ` in ${ws.figma_file_url}` : ''}: live text in our brand fonts, our brand kit colours, and the photos pushed from Emailsy. Its layout is in the asset's provenance.spec.`;
    try { await navigator.clipboard.writeText(prompt); } catch {}
    window.open(`https://claude.ai/new?q=${encodeURIComponent(prompt)}`, '_blank', 'noopener');
  }

  const setText = (v: Variant, i: number, text: string) => {
    if (!v.spec || !text) return;
    const layers = v.spec.layers.map((l, j) => (j === i && l.type === 'text' ? { ...l, text } : l));
    if (JSON.stringify(layers) !== JSON.stringify(v.spec.layers)) patch(v.key, { spec: { ...v.spec, layers }, history: [...v.history, v.spec], savedId: undefined });
  };

  const wide = format.w / format.h >= 2.5;
  const ready = variants.filter((v) => v.status === 'ready').length;

  return (
    <div className="studio">
      <div className="st-bar">
        <button className="ghost" type="button" onClick={onClose}><Icon.Back />New idea</button>
        <form className="st-brief" onSubmit={(e) => { e.preventDefault(); if (edit.trim() && edit.trim() !== brief) onBrief(edit.trim(), size); }}>
          <input className="in" value={edit} onChange={(e) => setEdit(e.target.value)} aria-label="Brief" />
          {edit.trim() !== brief && <button className="btn" type="submit">Redesign</button>}
        </form>
        <div className="st-formats" role="group" aria-label="Format">
          {FORMATS.filter((f) => !f.video).map((f) => {
            const r = f.w / f.h;
            return (
              <button key={f.id} type="button" title={`${f.label} · ${f.w}×${f.h}`} aria-pressed={f.id === format.id} onClick={() => f.id !== format.id && onBrief(brief, { w: f.w, h: f.h })}>
                <i style={r >= 1 ? { width: 22, height: Math.max(3, 22 / r) } : { height: 22, width: 22 * r }} /><span>{f.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="st-status" aria-live="polite">
        {loading ? <><span className="st-spin" />{STAGES[stage]}…</> : ready ? <>Double-click any text to edit it. Pick a design to change it with words.</> : null}
      </div>

      <div className={'st-grid' + (wide ? ' wide' : '')}>
        {variants.map((v, i) => {
          const r = v.size.w / v.size.h;
          const on = sel === v.key;
          return (
            <article key={v.key} className={'st-card' + (on ? ' on' : '') + (v.status === 'ready' ? ' ready' : '')} style={{ animationDelay: `${i * 60}ms` }} onClick={() => v.status === 'ready' && setSel(v.key)}>
              <div className="st-stage">
                <div className="st-fit" style={r >= 1.25 ? { width: '100%' } : { height: '100%', aspectRatio: `${r}` }}>
                  {v.spec ? (
                    <div className={'st-canvas' + (v.status === 'refining' ? ' busy' : '')}>
                      <DesignCanvas spec={v.spec} size={v.size} brand={brand} srcOf={srcOf} editable={v.status === 'ready'} onText={(li, t) => setText(v, li, t)} />
                    </div>
                  ) : v.status === 'error' ? (
                    <div className="st-skel err" style={{ aspectRatio: `${r}` }}><span>{v.error}</span></div>
                  ) : (
                    <div className="st-skel" style={{ aspectRatio: `${r}`, ['--a' as any]: brand.colors.primary, ['--b' as any]: brand.colors.accent }} />
                  )}
                </div>
                {v.spec && v.status === 'ready' && (
                  <div className="st-actions st-tools" onClick={(e) => e.stopPropagation()}>
                    {v.history.length > 0 && <button type="button" className="icon" title="Undo" onClick={() => undo(v)}>↶</button>}
                    <button type="button" onClick={() => download(v)} disabled={!!v.busy}>{v.busy === 'download' ? '…' : 'PNG'}</button>
                    <button type="button" onClick={() => everySize(v)}>Every size</button>
                    <button type="button" onClick={() => toFigma(v)} disabled={!!v.busy}>{v.busy === 'figma' ? 'Saving…' : 'Edit in Figma'}</button>
                    {v.savedId
                      ? <button type="button" className="saved" onClick={() => onOpenAsset(v.savedId!)}>✓ Saved</button>
                      : <button type="button" className="go" onClick={() => save(v)} disabled={!!v.busy}>{v.busy === 'saving' ? 'Saving…' : 'Save'}</button>}
                  </div>
                )}
              </div>
              <div className="st-meta">
                <div className="st-name">
                  <b>{v.spec?.name || (v.status === 'error' ? 'Didn’t work' : 'Designing…')}</b>
                  <small>{v.label ? `${v.label} · ` : ''}{v.size.w}×{v.size.h}{v.spec?.note ? ` · ${v.spec.note}` : ''}</small>
                </div>
                {v.status === 'error' && <div className="st-actions"><button type="button" onClick={() => { patch(v.key, { status: 'loading', error: undefined }); call({ size: v.size, variant: i % 3 }).then((r) => patch(v.key, r.spec ? { status: 'ready', spec: r.spec } : { status: 'error', error: r.error })); }}>Try again</button></div>}
              </div>
            </article>
          );
        })}
      </div>

      <form className={'st-refine' + (ready ? ' show' : '')} onSubmit={refine}>
        <span className="st-target">{selected?.spec ? `Changing “${selected.spec.name}”` : 'Pick a design, or change the first one'}</span>
        <input ref={refineBox} className="in" value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Say what to change: “darker”, “bigger headline”, “use the knitwear photo”, “add 20% off”" disabled={!ready} />
        <button className="primary" type="submit" disabled={!ask.trim() || !ready}><Icon.Sparkle size={15} />Change</button>
      </form>
    </div>
  );
}
