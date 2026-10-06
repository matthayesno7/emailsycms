'use client';
import { openInClaude as openClaude } from '@/lib/openClaude';
import { runKey } from '@/lib/plans';
import { openUpgrade } from './Billing';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import Studio, { formatFor } from './Studio';
import type { StudioBrand } from './DesignCanvas';
import { CATEGORIES, MOCKS, PROMPTS, USE_LABEL, fillPrompt, type PromptCategory } from '@/lib/prompts';
import { normaliseKit, type BrandKitRow } from '@/lib/brandKit';
import Mock, { type Brand } from './Mock';
import { Icon } from './icons';
import type { Asset, Ws } from './Library';

// Quick formats for the composer, drawn at their real proportions.
const FORMATS: { label: string; size: [number, number]; ask: string; video?: boolean }[] = [
  { label: 'Email hero', size: [1200, 600], ask: 'an email hero banner, 1200×600' },
  { label: 'LinkedIn banner', size: [1128, 191], ask: 'a LinkedIn company banner, 1128×191' },
  { label: 'LinkedIn post', size: [1200, 627], ask: 'a LinkedIn post image, 1200×627' },
  { label: 'Instagram post', size: [1080, 1350], ask: 'an Instagram post, 1080×1350' },
  { label: 'Story', size: [1080, 1920], ask: 'an Instagram story, 1080×1920' },
  { label: 'Square ad', size: [1080, 1080], ask: 'a square social ad, 1080×1080' },
  { label: 'Product reel', size: [1080, 1920], ask: 'a 6-second vertical product video, 1080×1920', video: true },
  { label: 'Animated banner', size: [1200, 600], ask: 'an animated email banner, 1200×600, under 4 seconds', video: true },
];

// One-click starters for the composer: words, and the size they suit (index into FORMATS).
const TRIES: { text: string; fmt: number }[] = [
  { text: 'Autumn sale email hero', fmt: 0 },
  { text: 'New arrivals LinkedIn post', fmt: 2 },
  { text: 'Instagram story for a product drop', fmt: 4 },
];

// The home page: Claude-first and visual. Describe it or pick a design from the library;
// Claude makes it with the brand kit and assets and saves it back for approval.
// Ideas the Studio can design right here (single-canvas designs; AI photos and video go to Claude).
const LIVE = new Set(['hero', 'strip', 'post', 'story', 'thumb', 'slide']);

export default function Create({ ws, userId, supabase, items, urls, kit, connected, onConnect, onBrandKit, onReview, onOpen, onSaved, toast, autoBrief, onAutoUsed }: {
  ws: Ws; userId: string; supabase: SupabaseClient; onSaved: () => void;
  items: Asset[]; urls: Record<string, string>; kit: BrandKitRow | null; connected: boolean;
  onConnect: () => void; onBrandKit: () => void; onReview: () => void; onOpen: (a: Asset) => void; toast: (m: string) => void;
  autoBrief?: string | null; onAutoUsed?: () => void; // first designs after sign-up
}) {
  const [cat, setCat] = useState<PromptCategory | 'all'>('all');
  const [ask, setAsk] = useState('');
  const [fmt, setFmt] = useState<number | null>(null);
  const [picked, setPicked] = useState<string | null>(null); // prompt id loaded into the composer
  const box = useRef<HTMLTextAreaElement>(null);
  const [live, setLive] = useState<boolean | null>(null); // can the Studio design here (API key set)?
  const [studio, setStudio] = useState<{ brief: string; size: { w: number; h: number } } | null>(null);
  useEffect(() => { fetch('/api/design').then((r) => r.json()).then((j) => setLive(!!j.enabled)).catch(() => setLive(false)); }, []);
  useEffect(() => {
    if (!autoBrief || live === null) return;
    if (live) setStudio({ brief: autoBrief, size: formatFor(autoBrief) });
    else setAsk(autoBrief);
    onAutoUsed?.();
  }, [autoBrief, live]); // eslint-disable-line react-hooks/exhaustive-deps

  const src = (a?: Asset) => (a ? (a.images?.email?.path && urls[a.images.email.path]) || (a.storage_path ? urls[a.storage_path] : undefined) : undefined);
  const products = useMemo(() => items.filter((i) => i.kind === 'product'), [items]);
  const photos = useMemo(() => items.filter((i) => i.kind === 'image' && i.origin !== 'generated'), [items]);
  // Pictures for the previews: the brand's own photos first, then product shots.
  const pool = useMemo(() => [...photos, ...products].map((a) => src(a)).filter(Boolean).slice(0, 12) as string[], [photos, products, urls]); // eslint-disable-line react-hooks/exhaustive-deps

  const k = normaliseKit(kit?.kit || { name: ws.name }, ws.name);
  const logoAsset = items.find((i) => i.id === k.logos.primary) || items.find((i) => i.kind === 'logo');
  const stack = (f: { family: string; fallback: string }) => [f.family && `'${f.family}'`, f.fallback].filter(Boolean).join(', ');
  const brand: Brand = {
    bg: k.colors.background || '#ffffff', surface: k.colors.surface || '#f1efeb', text: k.colors.text || '#1d1d1f',
    primary: k.colors.primary || '#1d1d1f', accent: k.colors.accent || k.colors.secondary || k.colors.primary || '#e8a317',
    btnBg: k.colors.button_bg || k.colors.primary || '#1d1d1f', btnText: k.colors.button_text || '#ffffff', radius: k.button.radius,
    head: stack(k.type.heading) || 'Georgia, serif', body: stack(k.type.body) || 'Arial, sans-serif', upper: k.type.heading_case === 'upper',
    logo: src(logoAsset), name: ws.name,
  };
  const fonts = [...new Set([k.type.heading.url, k.type.body.url].filter(Boolean))];
  const reversed = items.find((i) => i.id === k.logos.reversed);
  const studioBrand: StudioBrand = {
    colors: {
      primary: brand.primary, secondary: k.colors.secondary || brand.accent, accent: brand.accent, text: brand.text, text_muted: k.colors.text_muted || brand.text,
      background: brand.bg, surface: brand.surface, button_bg: brand.btnBg, button_text: brand.btnText, white: '#ffffff', black: '#111111',
    },
    head: brand.head, body: brand.body, upper: brand.upper,
    button: { style: k.button.style, radius: k.button.radius, weight: k.button.weight, upper: k.button.case === 'upper' },
    logo: brand.logo, logoReversed: reversed?.storage_path ? urls[reversed.storage_path] : undefined, name: ws.name,
  };
  const srcOf = (id: string) => { const a = items.find((i) => i.id === id); return a?.storage_path ? urls[a.storage_path] : undefined; };

  const fill = { brand: ws.name, figma: ws.figma_file_url };
  const shown = PROMPTS.filter((p) => cat === 'all' || p.category === cat);

  const text = (() => {
    const t = ask.trim();
    if (picked) return t;
    if (!t && fmt === null) return '';
    const f = fmt !== null ? FORMATS[fmt] : null;
    return `For ${ws.name}: ${t || `make ${f?.ask}`}${t && f ? `. Make it ${f.ask}` : ''}. Use our Mise brand kit and assets, make it in Figma${ws.figma_file_url ? ` (${ws.figma_file_url})` : ''}, and save the result to Mise.`;
  })();
  const blanks = { product: text.includes('[product]'), image: text.includes('[image]') };
  const chosen = fmt !== null ? FORMATS[fmt] : null;
  const pickedIdea = picked ? PROMPTS.find((p) => p.id === picked) : null;
  const pickedLive = !!pickedIdea && LIVE.has(MOCKS[pickedIdea.id]?.layout) && !pickedIdea.uses.some((u) => u === 'ai-image' || u === 'ai-video' || u === 'motion');
  const canDesign = !!live && !chosen?.video && (!picked || pickedLive);
  // Free: one Studio run. A different brief after it opens the trial pop-up straight away,
  // instead of starting designs that can't be made.
  const [freeRun, setFreeRun] = useState<{ free: boolean; run: string | null }>({ free: false, run: null });
  useEffect(() => {
    fetch(`/api/billing?workspace_id=${ws.id}`).then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setFreeRun({ free: j.billing?.plan === 'free', run: j.free?.studio_run || null })).catch(() => {});
  }, [ws.id]);
  function startStudio(brief: string, size: { w: number; h: number }) {
    const key = runKey(brief);
    if (freeRun.free && freeRun.run && freeRun.run !== key) { openUpgrade({ reason: 'studio' }); return; }
    if (freeRun.free && !freeRun.run) setFreeRun({ free: true, run: key });
    setStudio({ brief, size });
    window.scrollTo({ top: 0 });
  }
  function design() {
    const brief = picked ? clean(ask) : [ask.trim(), chosen ? `Format: ${chosen.ask}.` : ''].filter(Boolean).join(' ');
    if (!brief) return;
    const size = pickedIdea ? { w: MOCKS[pickedIdea.id].size[0], h: MOCKS[pickedIdea.id].size[1] } : chosen && !chosen.video ? { w: chosen.size[0], h: chosen.size[1] } : formatFor(brief);
    startStudio(brief, size);
  }
  function designIdea(id: string) {
    const p = PROMPTS.find((x) => x.id === id)!;
    const m = MOCKS[id];
    startStudio(clean(fillPrompt(p.prompt, fill)), { w: m.size[0], h: m.size[1] });
  }

  function usePrompt(id: string) {
    const idea = PROMPTS.find((x) => x.id === id)!;
    if (live && LIVE.has(MOCKS[id]?.layout) && !idea.uses.some((u) => u === 'ai-image' || u === 'ai-video' || u === 'motion')) { designIdea(id); return; }
    const p = PROMPTS.find((x) => x.id === id)!;
    setPicked(id); setFmt(null); setAsk(fillPrompt(p.prompt, fill));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => box.current?.focus({ preventScroll: true }), 300);
  }
  const fillBlank = (key: 'product' | 'image', a?: Asset) => a && setAsk((t) => t.replace(`[${key}]`, `"${a.name}"${a.pid ? ` (PID ${a.pid})` : ''}`));
  async function copy(t: string) { try { await navigator.clipboard.writeText(t); toast('Copied. Paste it into Claude.'); } catch { toast(t); } }
  const openInClaude = (t: string) => openClaude(t);

  const steps = [
    { done: connected, label: 'Connect Claude', note: 'Mise + Figma', go: onConnect },
    { done: kit?.status === 'approved', label: kit ? 'Approve your brand kit' : 'Brand kit', note: kit ? 'It’s a draft' : 'From your site or Figma', go: onBrandKit },
    { done: pool.length > 0, label: 'Add images', note: 'Photos, products, logos', go: undefined },
  ];

  if (studio) {
    return (
      <div className="create">
        {fonts.map((u) => <link key={u} rel="stylesheet" href={u} />)}
        <Studio ws={ws} userId={userId} supabase={supabase} brand={studioBrand} fonts={fonts} srcOf={srcOf}
          brief={studio.brief} size={studio.size} onBrief={(brief, size) => startStudio(brief, size)}
          onClose={() => setStudio(null)} onSaved={onSaved} onOpenAsset={(id) => { const a = items.find((i) => i.id === id); if (a) onOpen(a); else onSaved(); }} toast={toast} />
      </div>
    );
  }

  return (
    <div className="create">
      {fonts.map((u) => <link key={u} rel="stylesheet" href={u} />)}

      <section className="cr-hero">
        <h1>What do you want to make?</h1>
        <p className="cr-lede">Describe it in a sentence. Mise designs three options in your brand, with your photos.</p>

        <div className={'cr-compose' + (picked ? ' picked' : '')}>
          <div className="cr-sec">
            <div className="cr-label"><i>1</i>Describe it</div>
            {picked && <div className="cr-picked"><span>Idea: {PROMPTS.find((p) => p.id === picked)?.title}</span><button type="button" className="linkish" onClick={() => { setPicked(null); setAsk(''); }}>Clear</button></div>}
            <textarea ref={box} className="cr-input" rows={picked ? 4 : 2} value={ask} onChange={(e) => setAsk(e.target.value)}
              aria-label="Describe what you want to make"
              placeholder="e.g. A LinkedIn banner for our autumn launch, warm and simple"
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && text) { e.preventDefault(); if (canDesign) design(); else openInClaude(text); } }} />
            {!picked && !ask.trim() && (
              <div className="cr-tries"><span>Try:</span>
                {TRIES.map((t) => <button key={t.text} type="button" className="cr-try" onClick={() => { setAsk(t.text); setFmt(t.fmt); box.current?.focus(); }}>{t.text}</button>)}
              </div>
            )}
            {(blanks.product || blanks.image) && (
              <div className="cr-blanks">
                {blanks.product && products.length > 0 && (
                  <select className="in" value="" onChange={(e) => fillBlank('product', products.find((p) => p.id === e.target.value))}>
                    <option value="">Choose the product…</option>
                    {products.slice(0, 300).map((p) => <option key={p.id} value={p.id}>{p.pid} · {p.name}</option>)}
                  </select>
                )}
                {blanks.image && photos.length > 0 && (
                  <select className="in" value="" onChange={(e) => fillBlank('image', photos.find((p) => p.id === e.target.value))}>
                    <option value="">Choose the image…</option>
                    {photos.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                )}
                <span className="tip">or leave it and Claude will ask.</span>
              </div>
            )}
          </div>

          {!picked && (
            <div className="cr-sec cr-sec-line">
              <div className="cr-label"><i>2</i>Size <span className="cr-opt">· optional, we’ll pick one from your words</span></div>
              <div className="cr-sizes" role="group" aria-label="Size">
                <button type="button" className="cr-size" aria-pressed={fmt === null} onClick={() => setFmt(null)}><b>Auto</b></button>
                {FORMATS.map((f, i) => {
                  const r = f.size[0] / f.size[1];
                  const w = r >= 1 ? 18 : Math.max(8, Math.round(16 * r)), h = r >= 1 ? Math.max(4, Math.round(18 / r)) : 16;
                  return (
                    <button key={f.label} type="button" className="cr-size" aria-pressed={fmt === i} title={`${f.size[0]}×${f.size[1]}`} onClick={() => setFmt(fmt === i ? null : i)}>
                      {f.video ? <span className="cr-play" aria-hidden>▶</span> : <span className="cr-shape" style={{ width: w, height: h }} aria-hidden />}
                      <b>{f.label}</b>{f.video && <span className="cr-via">with Claude</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="cr-foot">
            <button type="button" className="cr-using" onClick={onBrandKit} title="Open the brand kit">
              <span className="cr-sw">{[brand.primary, brand.accent, brand.text].map((c, i) => <i key={i} style={{ background: c }} />)}</span>
              {kit ? <span>Using the <b>{ws.name}</b> brand kit{kit.status === 'approved' ? '' : ' (draft)'}{photos.length ? ` and ${photos.length} photo${photos.length === 1 ? '' : 's'}` : ''}</span>
                : <span>No brand kit yet · <u>set it up</u></span>}
            </button>
            <span className="spacer" />
            {canDesign ? (
              <button className="primary cr-go" type="button" onClick={() => (text ? design() : box.current?.focus())}>Design 3 options <span aria-hidden>→</span></button>
            ) : <>
              <button className="btn" type="button" disabled={!text} onClick={() => copy(text)}>Copy</button>
              <button className="primary cr-go" type="button" onClick={() => (text ? openInClaude(text) : box.current?.focus())}><Icon.Sparkle size={16} />Make it in Claude</button>
            </>}
          </div>
          {!canDesign && (chosen?.video || (picked && !pickedLive) || live === false) && (
            <p className="cr-note">{chosen?.video || (picked && !pickedLive) ? 'Video and new photography are made by Claude in Figma, then saved here. They’re edited in Figma too.'
              : 'Designs are made by Claude in Figma. Add ANTHROPIC_API_KEY on the server to design right here.'}</p>
          )}
        </div>

        {steps.some((s) => !s.done) && (
          <div className="cr-steps" aria-label="Setup">
            {steps.map((s, i) => (
              <button key={s.label} type="button" className={'cr-step' + (s.done ? ' done' : '')} disabled={!s.go || s.done} onClick={s.go}>
                <span className="n">{s.done ? '✓' : i + 1}</span><span><b>{s.label}</b><em>{s.done ? 'Done' : s.note}</em></span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="cr-h">
          <h2>Start from an idea</h2>
          <span className="tip">Previews use your brand kit and images. {live ? 'Click one and it’s designed for you in seconds.' : 'Click one to load it, then make it in Claude.'}</span>
        </div>
        <div className="seg cr-cats" role="group" aria-label="Category">
          {CATEGORIES.map(([c, l]) => <button key={c} type="button" aria-pressed={cat === c} onClick={() => setCat(c)}>{l}</button>)}
        </div>
        <div className="cr-gallery">
          {shown.map((p) => {
            const m = MOCKS[p.id] || { size: [1200, 600] as [number, number], layout: 'hero' as const };
            const r = m.size[0] / m.size[1];
            const t = fillPrompt(p.prompt, fill);
            return (
              <article key={p.id} className={'cr-idea' + (picked === p.id ? ' on' : '')}>
                <button type="button" className="cr-stage" onClick={() => usePrompt(p.id)} aria-label={`Use: ${p.title}`}>
                  <div className="cr-fit" style={r >= 4 / 3 ? { width: '86%' } : { height: '86%', aspectRatio: `${r}` }}>
                    <Mock layout={m.layout} size={m.size} brand={brand} images={rotate(pool, p.id)} headline={m.headline} video={m.video} />
                  </div>
                  <span className="cr-hover"><span>{t}</span></span>
                </button>
                <div className="cr-info">
                  <div><b>{p.title}</b><small>{p.format}</small></div>
                  <div className="cr-uses">{p.uses.filter((u) => u !== 'copy').map((u) => <span key={u} className={'use ' + u} title={USE_LABEL[u]}>{USE_LABEL[u]}</span>)}</div>
                </div>
                <div className="cr-mini">
                  <button type="button" onClick={() => usePrompt(p.id)}>{live && LIVE.has(m.layout) && !p.uses.some((x) => x === 'ai-image' || x === 'ai-video' || x === 'motion') ? 'Design it' : 'Use'}</button>
                  <button type="button" onClick={() => copy(t)}>Copy</button>
                  {!(live && LIVE.has(m.layout) && !p.uses.some((x) => x === 'ai-image' || x === 'ai-video' || x === 'motion')) && <button type="button" onClick={() => openInClaude(t)}>Open in Claude</button>}
                </div>
              </article>
            );
          })}
        </div>
        <p className="tip cr-foot">Designs made here are edited here. AI photos and video are made by Claude in Figma (using your Figma Weave credits; Claude shows the cost and asks first), land here as drafts, and are edited in Figma.</p>
      </section>
    </div>
  );
}

// Studio briefs don't need the Claude-chat housekeeping (saving, Figma, costs).
function clean(t: string) {
  return t.split(/(?<=\.)\s+/).filter((x) => !/save (it|the|all|each)|to (emailsy|mise)|figma|show me the cost/i.test(x)).join(' ').trim() || t;
}

// A different starting image per idea, so the gallery doesn't repeat one photo.
function rotate(pool: string[], seed: string) {
  if (!pool.length) return pool;
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const n = h % pool.length;
  return [...pool.slice(n), ...pool.slice(0, n)];
}
