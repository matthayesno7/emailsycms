'use client';
import { openInClaude as openClaude } from '@/lib/openClaude';
import { runKey } from '@/lib/plans';
import { openUpgrade } from './Billing';
import { useEffect, useMemo, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import Studio, { formatFor } from './Studio';
import Board, { type Mode, type Start } from './Board';
import type { StudioBrand } from './DesignCanvas';
import { CATEGORIES, MOCKS, PROMPTS, USE_LABEL, fillPrompt, type PromptCategory } from '@/lib/prompts';
import { normaliseKit, type BrandKitRow } from '@/lib/brandKit';
import Mock, { type Brand } from './Mock';
import type { Asset, Ws } from './Library';

// Ideas the Studio can design right here (single-canvas designs; AI photos and video go to Claude).
const LIVE = new Set(['hero', 'strip', 'post', 'story', 'thumb', 'slide']);

export default function Create({ ws, userId, supabase, items, urls, kit, connected, onConnect, onBrandKit, onReview, onOpen, onSaved, toast, autoBrief, onAutoUsed, plan = 'free', startAssets, onStartAssetsUsed }: {
  ws: Ws; userId: string; supabase: SupabaseClient; onSaved: () => void;
  items: Asset[]; urls: Record<string, string>; kit: BrandKitRow | null; connected: boolean;
  onConnect: () => void; onBrandKit: () => void; onReview: () => void; onOpen: (a: Asset) => void; toast: (m: string) => void;
  autoBrief?: string | null; onAutoUsed?: () => void; // first designs after sign-up
  plan?: string;
  startAssets?: string[] | null; onStartAssetsUsed?: () => void; // "Open in Create" from a file or a selection
}) {
  // Everything in Create happens on a board: a new one opens as the create stage.
  const [board, setBoard] = useState<string | null>(null);
  const [start, setStart] = useState<Start | null>(null);
  const [boards, setBoards] = useState<{ id: string; name: string; items: any[]; updated_at: string }[] | null>(null);
  useEffect(() => {
    if (board) return;
    supabase.from('boards').select('id, name, items, updated_at').eq('workspace_id', ws.id).order('updated_at', { ascending: false }).limit(24)
      .then(({ data }) => setBoards(data || []));
  }, [ws.id, board, supabase]);
  async function newBoard(name: string, s: Start | null) {
    const { data, error } = await supabase.from('boards').insert({ workspace_id: ws.id, name: name.trim().slice(0, 80) || 'Untitled board', created_by: userId }).select('id').single();
    if (error || !data) { toast('Couldn’t start a board. Try again.'); return; }
    setStart(s); setBoard(data.id as string);
    window.scrollTo({ top: 0 });
  }
  useEffect(() => {
    if (!startAssets?.length) return;
    const first = items.find((i) => i.id === startAssets[0]);
    newBoard(first ? first.name : 'New board', { mode: 'photo', assets: startAssets });
    onStartAssetsUsed?.();
  }, [startAssets]); // eslint-disable-line react-hooks/exhaustive-deps

  const [cat, setCat] = useState<PromptCategory | 'all'>('all');
  const [live, setLive] = useState<boolean | null>(null); // can the Studio design here (API key set)?
  const [studio, setStudio] = useState<{ brief: string; size: { w: number; h: number }; done?: (id: string, size?: { w: number; h: number }) => void } | null>(null);
  useEffect(() => { fetch('/api/design').then((r) => r.json()).then((j) => setLive(!!j.enabled)).catch(() => setLive(false)); }, []);
  const [media, setMedia] = useState<{ image: boolean; video: boolean }>({ image: false, video: false });
  useEffect(() => { fetch('/api/make').then((r) => r.json()).then((j) => setMedia({ image: !!j.image, video: !!j.video })).catch(() => {}); }, []);
  // First designs after sign-up: a board that starts designing straight away.
  useEffect(() => {
    if (!autoBrief || live === null) return;
    newBoard(autoBrief, { mode: 'design', prompt: autoBrief, size: formatFor(autoBrief), draft: !live });
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
  // Motion and "from Figma" ideas need Figma (and video, until it's switched on): hide them for brands without a Figma file.
  const needsFigma = (p: (typeof PROMPTS)[number]) => p.id === 'kit-figma' || p.uses.includes('motion') || (p.uses.includes('ai-video') && !media.video);
  const shown = PROMPTS.filter((p) => (cat === 'all' || p.category === cat) && (!!ws.figma_file_url || !needsFigma(p)));

  // Free: one Studio run. A different brief after it opens the upgrade pop-up straight away,
  // instead of starting designs that can't be made.
  const [freeRun, setFreeRun] = useState<{ free: boolean; run: string | null }>({ free: false, run: null });
  useEffect(() => {
    fetch(`/api/billing?workspace_id=${ws.id}`).then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setFreeRun({ free: j.billing?.plan === 'free', run: j.free?.studio_run || null })).catch(() => {});
  }, [ws.id]);
  // The designer, on top of a board.
  function openDesigner(brief: string, size: { w: number; h: number }, done?: (id: string, size?: { w: number; h: number }) => void) {
    const key = runKey(brief);
    if (freeRun.free && freeRun.run && freeRun.run !== key) { openUpgrade({ reason: 'studio' }); return false; }
    if (freeRun.free && !freeRun.run) setFreeRun({ free: true, run: key });
    setStudio({ brief, size, done });
    return true;
  }

  // An idea opens a new board with its words in the prompt, ready to send or change.
  function openIdea(id: string) {
    const idea = PROMPTS.find((x) => x.id === id)!;
    const m = MOCKS[id];
    const designable = LIVE.has(m?.layout) && !idea.uses.some((u) => u === 'ai-image' || u === 'ai-video' || u === 'motion');
    const mode: Mode = designable ? 'design' : idea.uses.includes('ai-video') && media.video ? 'video' : idea.uses.includes('ai-image') && media.image && !idea.uses.includes('motion') ? 'photo' : 'design';
    newBoard(idea.title, { mode, prompt: clean(fillPrompt(idea.prompt, fill)), size: m && mode !== 'video' ? { w: m.size[0], h: m.size[1] } : undefined, draft: true });
  }
  async function copy(t: string) { try { await navigator.clipboard.writeText(t); toast('Copied. Paste it into Claude.'); } catch { toast(t); } }
  // When something can't be made here, Claude makes it with the brand kit and saves it to Mise.
  const toClaude = (t: string) => {
    const how = ws.figma_file_url ? `make it in Figma (${ws.figma_file_url})` : 'make it with Mise’s own tools (its image model for any new imagery; no Figma)';
    openClaude(`For ${ws.name}: ${t}. Use our Mise brand kit and assets, ${how}, and save the result to Mise.`);
  };

  const steps = [
    { done: connected, label: 'Connect Claude', note: 'Optional: use Mise in Claude', go: onConnect },
    { done: kit?.status === 'approved', label: kit ? 'Approve your brand kit' : 'Brand kit', note: kit ? 'It’s a draft' : 'From your site or Figma', go: onBrandKit },
    { done: pool.length > 0, label: 'Add images', note: 'Photos, products, logos', go: undefined },
  ];

  if (board) {
    return (
      <div className="create on-board">
        {fonts.map((u) => <link key={u} rel="stylesheet" href={u} />)}
        <Board key={board} boardId={board} ws={ws} supabase={supabase} items={items} urls={urls} plan={plan}
          caps={{ design: !!live, image: media.image, video: media.video }} onClaude={toClaude}
          start={start} onStarted={() => setStart(null)}
          onBack={() => { setBoard(null); setStudio(null); }} onOpen={(id) => { const a = items.find((i) => i.id === id); if (a) onOpen(a); else onSaved(); }}
          onDesign={openDesigner} toast={toast} />
        {studio && (
          <div className="bd-studio">
            <Studio ws={ws} userId={userId} supabase={supabase} brand={studioBrand} fonts={fonts} srcOf={srcOf}
              brief={studio.brief} size={studio.size} onBrief={(brief, size) => openDesigner(brief, size, studio.done)}
              onClose={() => setStudio(null)}
              onSaved={(id, size) => { onSaved(); if (id && studio.done) { studio.done(id, size); setStudio(null); } }}
              onOpenAsset={(id) => { const a = items.find((i) => i.id === id); if (a) onOpen(a); else onSaved(); }} toast={toast} />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="create">
      {fonts.map((u) => <link key={u} rel="stylesheet" href={u} />)}

      <section className="cr-top">
        <div>
          <h1>Create</h1>
          <p className="cr-lede">Make something new from a sentence, or bring in your files and change them. Everything happens on a board, in your brand, with AI beside you.</p>
        </div>
        <button className="primary cr-new" type="button" onClick={() => newBoard('Untitled board', null)}>+ New board</button>
      </section>

      {steps.some((s) => !s.done) && (
        <div className="cr-steps left" aria-label="Setup">
          {steps.map((s, i) => (
            <button key={s.label} type="button" className={'cr-step' + (s.done ? ' done' : '')} disabled={!s.go || s.done} onClick={s.go}>
              <span className="n">{s.done ? '✓' : i + 1}</span><span><b>{s.label}</b><em>{s.done ? 'Done' : s.note}</em></span>
            </button>
          ))}
        </div>
      )}

      <section>
        <div className="cr-boards">
          <button type="button" className="cr-board new" onClick={() => newBoard('Untitled board', null)}>
            <span className="cr-board-img"><span className="cr-board-plus">+</span><span className="cr-board-hint">Describe something new<br />or start from your files</span></span>
            <b>New board</b><small>{boards && !boards.length ? 'Your first board' : 'Start fresh'}</small>
          </button>
          {(boards || []).map((b) => {
            const first = (b.items || []).find((it: any) => it.asset_id && items.some((a) => a.id === it.asset_id));
            const a = first ? items.find((x) => x.id === first.asset_id) : null;
            return (
              <button key={b.id} type="button" className="cr-board" onClick={() => { setStart(null); setBoard(b.id); }}>
                <span className="cr-board-img">{a && src(a) ? <img src={src(a)} alt="" /> : null}</span>
                <b>{b.name}</b><small>{(b.items || []).filter((x: any) => x.asset_id).length} files · {new Date(b.updated_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</small>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <div className="cr-h">
          <h2>Start from an idea</h2>
          <span className="tip">Previews use your brand kit and images. Pick one and it opens on a new board, ready to make or change.</span>
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
              <article key={p.id} className="cr-idea">
                <button type="button" className="cr-stage" onClick={() => openIdea(p.id)} aria-label={`Use: ${p.title}`}>
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
                  <button type="button" onClick={() => openIdea(p.id)}>Use</button>
                  <button type="button" onClick={() => copy(t)}>Copy</button>
                </div>
              </article>
            );
          })}
        </div>
        <p className="tip cr-foot">What AI makes lands in Review as a draft. Mise picks the best AI model for each job and shows it on every result.</p>
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
