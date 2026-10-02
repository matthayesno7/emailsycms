'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { loadImg } from '@/lib/images';
import { NO_EDIT, centredCrop, clamp, cropPixels, describe, dragCrop, encode, isUnchanged, outputSize, outputType, presetGroups, renderBase, renderFinal, turned, type Edit, type Preset, type TeamPreset } from '@/lib/imageEdit';
import type { BrandKit } from '@/lib/brandKit';
import type { Asset } from './Library';

export type EditResult = { blob: Blob; mime: string; width: number; height: number; note: string };

// Edit mode on the asset page: hands-on, instant and free. Crop (free or locked), sizes from the
// brand kit, rotate, flip, brightness, contrast, saturation. Saves as a new version of this asset
// (the original is kept) or as a copy. Designs made in Mise open in the Studio instead.
export default function ImageEditor({ it, src, kit, onCancel, onSave, onAddPreset, onFigmaWords, onMakeEditable, toast }: {
  it: Asset;
  src: string;
  kit: BrandKit | null;
  onCancel: () => void;
  onSave: (r: EditResult, asCopy: boolean) => Promise<boolean>;
  onAddPreset?: (p: TeamPreset) => Promise<boolean>;
  onFigmaWords?: (words: string) => void; // designed in Figma: Claude changes the words there and saves a new version here
  onMakeEditable?: () => Promise<void>; // rebuild the picture as a layout so its words can be edited on the canvas
  toast: (m: string) => void;
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [e, setE] = useState<Edit>(NO_EDIT);
  const [preset, setPreset] = useState('free');
  const [busy, setBusy] = useState<'' | 'version' | 'copy'>('');
  const [adding, setAdding] = useState<{ name: string; w: string; h: string } | null>(null);
  const [words, setWords] = useState<string>(it.text_in_image || '');
  const [rebuilding, setRebuilding] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const cut = useRef<{ cut?: HTMLCanvasElement }>({});
  const drag = useRef<{ handle: string; x: number; y: number; start: Edit['crop'] } | null>(null);
  const groups = useMemo(() => presetGroups(kit), [kit]);

  useEffect(() => { let alive = true; loadImg(src).then((i) => alive && setImg(i)).catch(() => toast('This image couldn’t be loaded for editing.')); return () => { alive = false; }; }, [src, toast]);

  const W = img?.naturalWidth || it.width || 1, H = img?.naturalHeight || it.height || 1;
  const t = turned(W, H, e.rotate);
  const out = outputSize(e, W, H);
  const cropPx = cropPixels(e, W, H);
  const upscaled = !!e.out && (e.out.w > cropPx.w * 1.05 || e.out.h > cropPx.h * 1.05);
  const type = outputType(it.mime || 'image/jpeg', e);

  // Live preview: the whole picture with rotation, flips and adjustments (the crop is drawn on top).
  useEffect(() => {
    if (!img || !canvas.current) return;
    const id = requestAnimationFrame(() => {
      const base = renderBase(img, e, 1400, cut.current);
      const cv = canvas.current!;
      cv.width = base.width; cv.height = base.height;
      cv.getContext('2d')!.drawImage(base, 0, 0);
    });
    return () => cancelAnimationFrame(id);
  }, [img, e.rotate, e.flipH, e.flipV, e.brightness, e.contrast, e.saturation, e.cutWhite]); // eslint-disable-line react-hooks/exhaustive-deps

  const ratioN = (r: number | null, tt = t) => (r ? (r * tt.h) / tt.w : null);
  const focus = it.focus || { x: 0.5, y: 0.5 };

  function pick(p: Preset) {
    setPreset(p.id);
    if (p.id === 'free') { setE((x) => ({ ...x, ratio: null, out: null, crop: x.crop || { x: 0.05, y: 0.05, w: 0.9, h: 0.9 } })); return; }
    const ratio = p.id === 'orig' ? t.w / t.h : p.ratio || (p.w && p.h ? p.w / p.h : null);
    if (!ratio) return;
    setE((x) => ({ ...x, ratio, out: p.w && p.h ? { w: p.w, h: p.h } : null, crop: centredCrop(ratio, t, focus) }));
  }
  function rotate(dir: 1 | -1) {
    setE((x) => {
      const r = (((x.rotate + dir * 90) % 360) + 360) % 360 as Edit['rotate'];
      const tt = turned(W, H, r);
      return { ...x, rotate: r, crop: x.ratio ? centredCrop(x.ratio, tt) : null };
    });
  }
  const set = (k: keyof Edit, v: any) => setE((x) => ({ ...x, [k]: v }));
  const reset = () => { setE(NO_EDIT); setPreset('free'); };

  function down(ev: React.PointerEvent, handle: string) {
    ev.preventDefault(); ev.stopPropagation();
    (ev.target as HTMLElement).setPointerCapture(ev.pointerId);
    drag.current = { handle, x: ev.clientX, y: ev.clientY, start: e.crop || { x: 0, y: 0, w: 1, h: 1 } };
  }
  function move(ev: React.PointerEvent) {
    const d = drag.current, el = stage.current;
    if (!d || !el || !d.start) return;
    const r = el.getBoundingClientRect();
    const next = dragCrop(d.start, d.handle, (ev.clientX - d.x) / r.width, (ev.clientY - d.y) / r.height, ratioN(e.ratio));
    setE((x) => ({ ...x, crop: next }));
  }
  // Drawing a new box on the picture (free crop).
  function startBox(ev: React.PointerEvent) {
    if (e.ratio || !stage.current) return;
    const r = stage.current.getBoundingClientRect();
    const px = clamp((ev.clientX - r.left) / r.width, 0, 1), py = clamp((ev.clientY - r.top) / r.height, 0, 1);
    setPreset('free');
    setE((x) => ({ ...x, crop: { x: px, y: py, w: 0.001, h: 0.001 } }));
    (ev.target as HTMLElement).setPointerCapture(ev.pointerId);
    drag.current = { handle: 'se', x: ev.clientX, y: ev.clientY, start: { x: px, y: py, w: 0.001, h: 0.001 } };
  }

  async function save(asCopy: boolean) {
    if (!img || isUnchanged(e)) return;
    setBusy(asCopy ? 'copy' : 'version');
    try {
      const cv = renderFinal(img, e, cut.current);
      const blob = await encode(cv, type, type === 'image/jpeg' ? 0.92 : 0.9);
      const ok = await onSave({ blob, mime: blob.type || type, width: cv.width, height: cv.height, note: describe(e, W, H) }, asCopy);
      if (!ok) setBusy('');
    } catch (err: any) {
      toast(err?.message || 'Couldn’t save the edit.');
      setBusy('');
    }
  }

  const c = e.crop;
  return (
    <div className="ed-body editing">
      <section className="ed-canvas" aria-label="Canvas">
        <div className="ed-tools">
          <div className="seg" role="group" aria-label="Rotate and flip">
            <button type="button" title="Rotate left" onClick={() => rotate(-1)}>⟲</button>
            <button type="button" title="Rotate right" onClick={() => rotate(1)}>⟳</button>
            <button type="button" title="Flip horizontally" aria-pressed={e.flipH} onClick={() => set('flipH', !e.flipH)}>⇋</button>
            <button type="button" title="Flip vertically" aria-pressed={e.flipV} onClick={() => set('flipV', !e.flipV)}>⇵</button>
          </div>
          <span className="spacer" />
          <span className="ie-out">{out.w}×{out.h} · {type.split('/')[1].toUpperCase().replace('JPEG', 'JPG')}</span>
        </div>
        <div className="ed-stage ie-stage">
          {!img ? <p className="tip">Loading…</p> : (
            <div className="ie-frame" style={{ aspectRatio: `${t.w} / ${t.h}` }}>
              <div ref={stage} className="ie-pic" onPointerDown={startBox} onPointerMove={move} onPointerUp={() => (drag.current = null)}>
                <canvas ref={canvas} />
                {c && (
                  <>
                    <div className="ie-shade" style={{ clipPath: `polygon(0 0,100% 0,100% 100%,0 100%,0 0,${c.x * 100}% ${c.y * 100}%,${c.x * 100}% ${(c.y + c.h) * 100}%,${(c.x + c.w) * 100}% ${(c.y + c.h) * 100}%,${(c.x + c.w) * 100}% ${c.y * 100}%,${c.x * 100}% ${c.y * 100}%)` }} />
                    <div className="ie-box" style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: `${c.w * 100}%`, height: `${c.h * 100}%` }} onPointerDown={(ev) => down(ev, 'move')}>
                      <i className="g1" /><i className="g2" /><i className="g3" /><i className="g4" />
                      {['nw', 'ne', 'sw', 'se'].map((h) => <b key={h} className={'ie-h ' + h} onPointerDown={(ev) => down(ev, h)} />)}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
          <span className="hint">{e.ratio ? 'Drag the box to choose what stays in, or a corner to resize it' : 'Drag on the picture to crop, or pick a size'}</span>
        </div>
      </section>

      <aside className="ed-side ie-side" aria-label="Edit">
        <div className="ie-scroll">
        {(onFigmaWords || it.text_in_image) && (
          <div className="ed-sec">
            <div className="label">Words</div>
            {onMakeEditable && (
              <>
                <button type="button" className="primary" disabled={rebuilding} onClick={async () => { setRebuilding(true); try { await onMakeEditable(); } finally { setRebuilding(false); } }}>{rebuilding ? 'Rebuilding the layout…' : 'Edit the words on the canvas'}</button>
                <p className="tip">Claude rebuilds this layout with your brand kit and the photos it was made from, so you can change the words, swap photos and edit it on the canvas, the same as designs made in Create. Check it against the original before saving; the original stays in the history.</p>
              </>
            )}
            {onFigmaWords && (
              <details className="alt-route">
                <summary>Or change it in Figma, where it was designed</summary>
                <textarea className="in" rows={3} value={words} onChange={(ev) => setWords(ev.target.value)} placeholder="Write the new words, or say what to change" />
                <button type="button" className="btn" disabled={!words.trim() || words.trim() === (it.text_in_image || '').trim()} onClick={() => onFigmaWords(words.trim())}>Change the words in Figma</button>
                <p className="tip">Claude updates the Figma frame and saves it back here as version {(it.version || 1) + 1}.</p>
              </details>
            )}
            {!onMakeEditable && !onFigmaWords && <p className="tip">The words are part of the picture.</p>}
          </div>
        )}
        <div className="ed-sec">
          <div className="label">Crop and size</div>
          {groups.map((g) => (
            <div key={g.name} className="ie-group">
              <span className="ie-gname">{g.name}</span>
              <div className="ed-sizes">
                {g.items.map((p) => (
                  <button key={p.id} className="chip" type="button" aria-pressed={preset === p.id} onClick={() => pick(p)} title={p.w ? `${p.w}×${p.h}` : undefined}>
                    <b>{p.name}</b>{p.w ? <span>{p.w}×{p.h}</span> : null}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {onAddPreset && (adding ? (
            <form className="ie-add" onSubmit={async (ev) => { ev.preventDefault(); const w = +adding.w, h = +adding.h; if (!adding.name.trim() || !(w >= 16 && h >= 16)) { toast('Give it a name and a size.'); return; } if (await onAddPreset({ name: adding.name.trim(), w, h })) { setAdding(null); toast('Size added for your team'); } }}>
              <input className="in" placeholder="Name, e.g. Retailer hero" value={adding.name} onChange={(ev) => setAdding({ ...adding, name: ev.target.value })} autoFocus />
              <input className="in" inputMode="numeric" placeholder="W" value={adding.w} onChange={(ev) => setAdding({ ...adding, w: ev.target.value.replace(/\D/g, '') })} />
              <span>×</span>
              <input className="in" inputMode="numeric" placeholder="H" value={adding.h} onChange={(ev) => setAdding({ ...adding, h: ev.target.value.replace(/\D/g, '') })} />
              <button className="btn" type="submit">Add</button>
            </form>
          ) : <button type="button" className="linkish" onClick={() => setAdding({ name: '', w: e.out ? String(e.out.w) : '', h: e.out ? String(e.out.h) : '' })}>+ Add a size for your team</button>)}
          {upscaled && <p className="warn">The crop is {cropPx.w}×{cropPx.h}, smaller than {out.w}×{out.h}: it’ll be enlarged and may look soft.</p>}
        </div>

        <div className="ed-sec">
          <div className="label">Adjust</div>
          {([['brightness', 'Brightness'], ['contrast', 'Contrast'], ['saturation', 'Saturation']] as const).map(([k, l]) => (
            <label key={k} className="ie-slider">
              <span>{l}</span>
              <input type="range" min={-100} max={100} step={1} value={e[k]} onChange={(ev) => set(k, +ev.target.value)} onDoubleClick={() => set(k, 0)} />
              <output>{e[k] > 0 ? `+${e[k]}` : e[k]}</output>
            </label>
          ))}
          <label className="toggle"><input type="checkbox" checked={e.cutWhite} onChange={(ev) => set('cutWhite', ev.target.checked)} /> Remove white background</label>
          {!isUnchanged(e) && <button type="button" className="linkish" onClick={reset}>Reset all</button>}
        </div>

        </div>
        <div className="ie-save">
          <p className="tip">{isUnchanged(e) ? 'Make a change to save it.' : `${describe(e, W, H)}. The original is kept in version history.`}</p>
          <div className="ie-row">
            <button className="btn" type="button" disabled={!!busy || isUnchanged(e)} onClick={() => save(true)} title="Keep this asset as it is and save the edit as a new asset">{busy === 'copy' ? 'Saving…' : 'Save as copy'}</button>
            <button className="primary grow" type="button" disabled={!!busy || isUnchanged(e)} onClick={() => save(false)}>{busy === 'version' ? 'Saving…' : `Save as version ${(it.version || 1) + 1}`}</button>
          </div>
          <div className="ie-row links">
            <button className="linkish" type="button" onClick={onCancel} disabled={!!busy}>Cancel</button>
            <button className="linkish" type="button" disabled={!!busy || isUnchanged(e) || !img} title="Download the result without saving it" onClick={async () => {
              try {
                const blob = await encode(renderFinal(img!, e, cut.current), type, 0.9);
                const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
                a.download = `${(it.pid || it.name).replace(/[^\w.-]+/g, '-').toLowerCase()}-${out.w}x${out.h}.${blob.type.split('/')[1].replace('jpeg', 'jpg')}`;
                document.body.appendChild(a); a.click(); a.remove();
              } catch { toast('Couldn’t export.'); }
            }}>Download</button>
          </div>
        </div>
      </aside>
    </div>
  );
}

