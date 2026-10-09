'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SOCIAL_SIZES, SUGGESTED, actionById, actionDesigns, type ActionDef, type ActionId } from '@/lib/actions';
import { bounds, itemHeight, place, uid, type BoardItem, type Turn } from '@/lib/boards';
import { modelName, nearestAspect } from '@/lib/models';
import { formatFor } from './Studio';
import { openUpgrade } from './Billing';
import { Icon } from './icons';
import type { Asset, Ws } from './Library';

// A Create board: a canvas of files and everything made from them, with AI beside it.
// Select something and ask for a change, or start from words. Everything AI makes is saved to the
// library as a draft (Review) and placed on the board next to what it came from.
export type Mode = 'design' | 'photo' | 'video';
// How a board starts: with files (and optionally what to do with them), or with words.
// draft: put the words in the prompt for the person to send, rather than running them.
export type Start = { mode: Mode; prompt?: string; size?: { w: number; h: number }; assets?: string[]; draft?: boolean };
// What this Mise can make right here (the rest goes to Claude).
export type Caps = { design: boolean; image: boolean; video: boolean };

// Sizes for the create stage, drawn at their real proportions.
const FORMATS: { label: string; w: number; h: number }[] = [
  { label: 'Email hero', w: 1200, h: 600 },
  { label: 'LinkedIn banner', w: 1128, h: 191 },
  { label: 'LinkedIn post', w: 1200, h: 627 },
  { label: 'Instagram post', w: 1080, h: 1350 },
  { label: 'Story', w: 1080, h: 1920 },
  { label: 'Square', w: 1080, h: 1080 },
];
const VIDEO_FORMATS: { label: string; w: number; h: number }[] = [
  { label: 'Reel or story', w: 1080, h: 1920 },
  { label: 'Landscape', w: 1920, h: 1080 },
];
const MODE_LABEL: Record<Mode, string> = { design: 'Design', photo: 'Photo', video: 'Video' };

const TRIES: Record<Mode, string[]> = {
  design: ['Autumn sale email hero', 'New arrivals LinkedIn post', 'Instagram story for a product drop'],
  photo: ['Our product on a marble counter, morning light', 'A flat lay of our range on linen'],
  video: ['Slow push-in on our product, soft café sounds', 'A product turntable on a brand-colour backdrop'],
};
const usable = (a?: Asset | null) => !!a && ['image', 'logo', 'product'].includes(a.kind) && !!a.storage_path && !/svg|gif|video/.test(a.mime || '');
const now = () => new Date().toISOString();

export default function Board({ boardId, ws, supabase, items: library, urls, plan, caps, start, onStarted, onBack, onOpen, onDesign, onClaude, toast }: {
  boardId: string; ws: Ws; supabase: SupabaseClient; items: Asset[]; urls: Record<string, string>; plan: string;
  caps: Caps; onClaude: (prompt: string) => void;
  start?: Start | null; onStarted?: () => void;
  onBack: () => void; onOpen: (id: string) => void;
  onDesign: (brief: string, size: { w: number; h: number }, done: (id: string, size?: { w: number; h: number }) => void) => boolean;
  toast: (m: string) => void;
}) {
  const [name, setName] = useState('Untitled board');
  const [cards, setCards] = useState<BoardItem[]>([]);
  const [thread, setThread] = useState<Turn[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const [view, setView] = useState({ x: 60, y: 60, s: 0.8 });
  const [mode, setMode] = useState<Mode>('design');
  const [text, setText] = useState('');
  const [ask, setAsk] = useState<ActionDef | null>(null); // a suggestion waiting for its option
  const [adding, setAdding] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null); // the create stage's size (null: from the words)
  const stageBox = useRef<HTMLTextAreaElement>(null);
  // A new board takes its name from the first thing made or added to it.
  const autoName = (t: string) => setName((n) => (!n.trim() || n === 'Untitled board' || n === 'New board' ? t.trim().replace(/\s+/g, ' ').slice(0, 60) : n));
  const cv = useRef<HTMLDivElement>(null);
  const threadEnd = useRef<HTMLDivElement>(null);
  const cardsRef = useRef(cards); cardsRef.current = cards;

  // ---------- load and save ----------
  useEffect(() => {
    let off = false;
    supabase.from('boards').select('*').eq('id', boardId).maybeSingle().then(({ data }) => {
      if (off || !data) return;
      setName(data.name); setCards(data.items || []); setThread(data.thread || []); setLoaded(true);
    });
    return () => { off = true; };
  }, [boardId, supabase]);
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      supabase.from('boards').update({ name: name.trim() || 'Untitled board', items: cards, thread: thread.slice(-200), updated_at: now() }).eq('id', boardId).then(({ error }) => { if (error) console.error('[board] save', error.message); });
    }, 700);
    return () => clearTimeout(t);
  }, [cards, thread, name, loaded, boardId, supabase]);

  // ---------- files ----------
  const byId = useMemo(() => new Map(library.map((a) => [a.id, a])), [library]);
  const srcOf = (c: BoardItem) => {
    const a = c.asset_id ? byId.get(c.asset_id) : null;
    if (a) return (a.kind !== 'video' && a.images?.email?.path && urls[a.images.email.path]) || (a.storage_path && urls[a.storage_path]) || c.url || null;
    return c.url || null;
  };
  const assetOf = (c: BoardItem) => (c.asset_id ? byId.get(c.asset_id) || null : null);
  const selected = cards.filter((c) => sel.includes(c.id) && c.asset_id && !c.pending);
  const selAssets = selected.map(assetOf).filter(Boolean) as Asset[];
  const selImages = selected.filter((c) => usable(assetOf(c)));

  const fit = useCallback(() => {
    const el = cv.current; if (!el) return;
    const b = bounds(cardsRef.current);
    const s = Math.min(1.2, Math.max(0.15, Math.min((el.clientWidth - 120) / Math.max(b.w, 1), (el.clientHeight - 140) / Math.max(b.h, 1))));
    setView({ s, x: (el.clientWidth - b.w * s) / 2 - b.x * s, y: (el.clientHeight - b.h * s) / 2 - b.y * s });
  }, []);
  useEffect(() => { if (loaded) setTimeout(fit, 50); }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { threadEnd.current?.scrollIntoView({ block: 'end' }); }, [thread.length]);

  const say = (t: Omit<Turn, 'id' | 'at'>) => setThread((all) => [...all, { id: uid(), at: now(), ...t }]);
  const ratioOf = (a?: Asset | null) => (a?.width && a?.height ? a.width / a.height : 1);

  function addAssets(ids: string[], from?: BoardItem | null) {
    const list = ids.map((id) => byId.get(id)).filter(Boolean) as Asset[];
    if (!list.length) return [];
    const spots = place(cardsRef.current, list.map(ratioOf), from);
    const add: BoardItem[] = list.map((a, i) => ({ id: uid(), asset_id: a.id, name: a.name, ...spots[i] }));
    cardsRef.current = [...cardsRef.current, ...add]; // so the next placement sees these straight away
    setCards((all) => [...all, ...add]);
    return add;
  }

  // ---------- making ----------
  // Placeholders appear at once where the results will go; they're swapped for the files when they arrive.
  function holders(from: BoardItem | null, ratios: number[], pending: BoardItem['pending']) {
    const spots = place(cardsRef.current, ratios, from);
    const hs: BoardItem[] = spots.map((p) => ({ id: uid(), ...p, pending }));
    cardsRef.current = [...cardsRef.current, ...hs];
    setCards((all) => [...all, ...hs]);
    return hs;
  }
  function fill(hs: BoardItem[], got: { id: string; name: string; url: string | null; width: number | null; height: number | null }[]) {
    setCards((all) => {
      let next = all.filter((c) => !hs.slice(got.length).some((h) => h.id === c.id));
      next = next.map((c) => {
        const i = hs.findIndex((h) => h.id === c.id);
        if (i < 0 || i >= got.length) return c;
        const g = got[i];
        return { id: c.id, x: c.x, y: c.y, w: c.w, asset_id: g.id, name: g.name, url: g.url, ratio: g.width && g.height ? g.width / g.height : c.ratio };
      });
      return next;
    });
  }
  const drop = (hs: BoardItem[]) => setCards((all) => all.filter((c) => !hs.some((h) => h.id === c.id)));

  async function post(url: string, body: any) {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace_id: ws.id, ...body }) }).catch(() => null);
    const j = await r?.json().catch(() => null);
    return { ok: !!r?.ok, status: r?.status || 0, j: j || {} };
  }
  const blocked = (status: number, j: any, reason: 'media' | 'edit') => {
    if (status === 402 || j?.code === 'upgrade') { openUpgrade({ reason }); return true; }
    return false;
  };

  async function runAction(id: ActionId, choice = '', detail = '', from?: BoardItem[]) {
    const def = actionById(id); if (!def) return;
    const sources = (def.batch ? (from || selImages) : (from || selImages).slice(0, 1)).slice(0, 10);
    if (!sources.length) { toast('Select a photo on the board first.'); return; }
    if (plan === 'free') { openUpgrade({ reason: def.kind === 'resize' ? 'edit' : 'media' }); return; }
    say({ role: 'you', text: id === 'edit' ? detail : `${def.title}${choice ? `: ${choice}` : ''}${detail ? ` (${detail})` : ''}`, refs: sources.map((s) => s.asset_id!) });
    if (def.kind === 'video') {
      const src = sources[0], a = assetOf(src);
      const hs = holders(src, [(a?.width || 16) < (a?.height || 9) ? 9 / 16 : 16 / 9], { kind: 'video', label: choice || 'Clip' });
      const { ok, status, j } = await post('/api/make/action', { action: id, asset_ids: [src.asset_id], choice, detail });
      if (blocked(status, j, 'media')) { drop(hs); return; }
      if (!ok) { drop(hs); say({ role: 'mise', text: j.error || 'Couldn’t start the clip.', error: true }); return; }
      setCards((all) => all.map((c) => (c.id === hs[0].id ? { ...c, pending: { kind: 'video', job: j.job, label: choice || 'Clip' } } : c)));
      say({ role: 'mise', text: `Making a clip with ${modelName(j.model) || 'Veo'}. It takes one to three minutes and appears here and in Review as a draft.`, made: hs.map((h) => h.id) });
      return;
    }
    const per = def.kind === 'resize' ? SOCIAL_SIZES.map((s) => s.w / s.h) : Array(def.takes || 1).fill(0).map(() => 0);
    const groups = sources.map((s) => holders(s, per.map((r) => r || ratioOf(assetOf(s))), { kind: 'photo', label: def.kind === 'resize' ? 'Resizing' : choice || detail || def.title }));
    const { ok, status, j } = await post('/api/make/action', { action: id, asset_ids: sources.map((s) => s.asset_id), choice, detail });
    if (blocked(status, j, def.kind === 'resize' ? 'edit' : 'media')) { groups.forEach(drop); return; }
    if (!ok) { groups.forEach(drop); say({ role: 'mise', text: j.error || 'Couldn’t make that. Try again.', error: true }); return; }
    const made: string[] = [];
    sources.forEach((s, i) => {
      const r = (j.results || []).find((x: any) => x.source.id === s.asset_id);
      fill(groups[i], r?.assets || []);
      made.push(...groups[i].slice(0, r?.assets?.length || 0).map((h) => h.id));
    });
    const n = made.length, errs = (j.results || []).filter((r: any) => r.error);
    say({
      role: 'mise', made,
      text: !n ? (errs[0]?.error || 'Nothing came back. Try another option or reword it.')
        : def.kind === 'resize' ? `${n} ${n === 1 ? 'copy' : 'copies'} for social, saved next to the original${sources.length > 1 ? 's' : ''}.`
        : `${n} new ${n === 1 ? 'version' : 'versions'} with ${modelName(j.model) || 'Mise'}${j.designs ? ` (${j.designs} design${j.designs === 1 ? '' : 's'})` : ''}. ${n === 1 ? 'It’s a draft' : 'They’re drafts'} in Review.${errs.length ? ` ${errs.length} couldn’t be made.` : ''}`,
      error: !n,
    });
  }

  async function runWords(prompt: string, m: Mode, size?: { w: number; h: number }) {
    const p = prompt.trim(); if (!p) return;
    say({ role: 'you', text: p });
    autoName(p);
    if (m === 'design') {
      const ok = onDesign(p, size || formatFor(p), (id, sz) => {
        const spot = place(cardsRef.current, [sz ? sz.w / sz.h : 2])[0];
        const it: BoardItem = { id: uid(), asset_id: id, ...spot };
        cardsRef.current = [...cardsRef.current, it];
        setCards((all) => [...all, it]);
        say({ role: 'mise', text: 'Saved the design to your library and put it on the board.', made: [it.id] });
      });
      if (ok) say({ role: 'mise', text: 'Designing three options in your brand. Pick one, change it if you like, and save it to put it on the board.' });
      return;
    }
    if (plan === 'free') { openUpgrade({ reason: 'media' }); return; }
    if (m === 'video') {
      const vertical = size ? size.h > size.w : /reel|story|stories|vertical|tiktok|9:16/i.test(p);
      const hs = holders(null, [vertical ? 9 / 16 : 16 / 9], { kind: 'video', label: 'Clip' });
      const { ok, status, j } = await post('/api/make/video', { prompt: p, aspect: vertical ? '9:16' : '16:9', seconds: 8 });
      if (blocked(status, j, 'media')) { drop(hs); return; }
      if (!ok) { drop(hs); say({ role: 'mise', text: j.error || 'Couldn’t start the clip.', error: true }); return; }
      setCards((all) => all.map((c) => (c.id === hs[0].id ? { ...c, pending: { kind: 'video', job: j.job, label: 'Clip' } } : c)));
      say({ role: 'mise', text: `Making a clip with ${modelName(j.model) || 'Veo'}. It takes one to three minutes.`, made: hs.map((h) => h.id) });
      return;
    }
    // A size in the words (Instagram, story, banner…) sets the shape; otherwise a 4:3 photo.
    const sz = size || (/email|banner|hero|linkedin|instagram|insta|stor(y|ies)|reel|tiktok|square|\bads?\b|facebook/i.test(p) ? formatFor(p) : { w: 4, h: 3 });
    const aspect = nearestAspect(sz.w, sz.h);
    const [aw, ah] = aspect.split(':').map(Number);
    const hs = holders(null, [aw / ah, aw / ah], { kind: 'photo', label: p.slice(0, 40) });
    const { ok, status, j } = await post('/api/make', { prompt: p, aspect, count: 2 });
    if (blocked(status, j, 'media')) { drop(hs); return; }
    if (!ok) { drop(hs); say({ role: 'mise', text: j.error || 'Couldn’t make that. Try again.', error: true }); return; }
    fill(hs, j.assets || []);
    say({ role: 'mise', text: `${(j.assets || []).length} photos with ${modelName(j.model) || 'Mise'} (${j.designs} designs). They’re drafts in Review.`, made: hs.map((h) => h.id) });
  }

  function send() {
    const t = text.trim(); if (!t) return;
    setText('');
    if (selImages.length) {
      if (/\b(animate|video|clip|motion)\b/i.test(t)) runAction('animate', 'Slow push-in', t);
      else if (/\b(resize|sizes|instagram sizes|social sizes)\b/i.test(t)) runAction('resize');
      else runAction('edit', '', t);
    } else runWords(t, mode);
  }

  // Start the board the way it was opened: with files, or with words.
  const started = useRef(false);
  useEffect(() => {
    if (!loaded || !start || started.current) return;
    started.current = true;
    setMode(start.mode);
    if (start.draft) {
      setText(start.prompt || ''); setSize(start.size || null);
      setTimeout(() => stageBox.current?.focus(), 60);
      onStarted?.();
      return;
    }
    const add = start.assets?.length ? addAssets(start.assets) : [];
    if (add.length) { setSel(add.map((a) => a.id)); setTimeout(fit, 80); }
    const p = (start.prompt || '').trim();
    // Words with a photo: a new scene for it (or a clip from it). Words alone: make it from scratch.
    if (p && add.length) runAction(start.mode === 'video' ? 'animate' : 'scene', start.mode === 'video' ? 'Slow push-in' : '', p, add.filter((c) => usable(byId.get(c.asset_id!))));
    else if (p) runWords(p, start.mode, start.size);
    onStarted?.();
  }, [loaded, start]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clips: check every 8 seconds until they're saved.
  const waiting = cards.filter((c) => c.pending?.kind === 'video' && c.pending.job);
  useEffect(() => {
    if (!waiting.length) return;
    const t = setInterval(() => {
      for (const c of waiting) {
        fetch(`/api/make/video?workspace_id=${ws.id}&job=${encodeURIComponent(c.pending!.job!)}`).then((r) => r.json().then((j) => ({ ok: r.ok, j }))).then(({ ok, j }) => {
          if (!ok) setCards((all) => all.map((x) => (x.id === c.id ? { ...x, pending: undefined, error: j.error || 'The clip couldn’t be made.' } : x)));
          else if (j.ready) { setCards((all) => all.map((x) => (x.id === c.id ? { id: x.id, x: x.x, y: x.y, w: x.w, ratio: x.ratio, asset_id: j.asset.id, name: j.asset.name, url: j.asset.url } : x))); toast('Your clip is ready'); }
        }).catch(() => {});
      }
    }, 8000);
    return () => clearInterval(t);
  }, [waiting.map((c) => c.id).join(','), ws.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- canvas: pan, zoom, select, move ----------
  useEffect(() => {
    const el = cv.current; if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
        setView((v) => { const s = Math.min(3, Math.max(0.1, v.s * Math.exp(-e.deltaY * 0.01))); return { s, x: px - ((px - v.x) * s) / v.s, y: py - ((py - v.y) * s) / v.s }; });
      } else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [loaded]);
  const drag = useRef<{ kind: 'pan' | 'move'; sx: number; sy: number; vx: number; vy: number; ids?: string[]; orig?: Map<string, { x: number; y: number }>; moved?: boolean; card?: string; add?: boolean } | null>(null);
  function downBg(e: React.PointerEvent) {
    if (e.button !== 0) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
  }
  function downCard(e: React.PointerEvent, c: BoardItem) {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const ids = e.shiftKey || e.metaKey ? (sel.includes(c.id) ? sel.filter((x) => x !== c.id) : [...sel, c.id]) : sel.includes(c.id) ? sel : [c.id];
    setSel(ids); setAsk(null);
    drag.current = { kind: 'move', card: c.id, add: e.shiftKey || e.metaKey, sx: e.clientX, sy: e.clientY, vx: 0, vy: 0, ids, orig: new Map(cards.filter((x) => ids.includes(x.id)).map((x) => [x.id, { x: x.x, y: x.y }])) };
  }
  function move(e: React.PointerEvent) {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.kind === 'pan') setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
    else if (d.moved) setCards((all) => all.map((c) => { const o = d.orig!.get(c.id); return o ? { ...c, x: o.x + dx / view.s, y: o.y + dy / view.s } : c; }));
  }
  function up() {
    const d = drag.current; drag.current = null;
    if (d?.kind === 'pan' && !d.moved) { setSel([]); setAsk(null); }
    // A click (no drag) on one of several selected: just that one.
    if (d?.kind === 'move' && !d.moved && !d.add && d.card && (d.ids?.length || 0) > 1) setSel([d.card]);
  }
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) { setCards((all) => all.filter((c) => !sel.includes(c.id))); setSel([]); }
      if (e.key === 'Escape') { setSel([]); setAsk(null); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [sel]);
  const zoom = (f: number) => {
    const el = cv.current; if (!el) return;
    const px = el.clientWidth / 2, py = el.clientHeight / 2;
    setView((v) => { const s = Math.min(3, Math.max(0.1, v.s * f)); return { s, x: px - ((px - v.x) * s) / v.s, y: py - ((py - v.y) * s) / v.s }; });
  };

  async function deleteBoard() {
    if (!confirm(`Delete “${name}”? The files made on it stay in your library.`)) return;
    const { error } = await supabase.from('boards').delete().eq('id', boardId);
    if (error) { toast('Couldn’t delete the board.'); return; }
    toast('Board deleted'); onBack();
  }

  const cost = (a: ActionDef) => { const d = actionDesigns(a) * (a.batch ? Math.max(1, selImages.length) : 1); return a.kind === 'resize' ? 'No AI' : `${d} design${d === 1 ? '' : 's'}`; };
  const single = selAssets.length === 1 ? selAssets[0] : null;

  // An empty board is the create stage: say what to make, or bring in files. The chat appears once something's on it.
  const bare = loaded && !cards.length && !thread.length;
  const can = mode === 'design' ? caps.design : mode === 'photo' ? caps.image : caps.video;
  function go() {
    const t = text.trim();
    if (!t) { stageBox.current?.focus(); return; }
    if (!can) { onClaude(t); return; }
    setText(''); runWords(t, mode, size || undefined);
  }
  const sizes = mode === 'video' ? VIDEO_FORMATS : FORMATS;
  const custom = size && !sizes.some((f) => f.w === size.w && f.h === size.h) ? size : null;
  const shape = (w: number, h: number) => { const r = w / h; return r >= 1 ? { width: 18, height: Math.max(4, Math.round(18 / r)) } : { width: Math.max(8, Math.round(16 * r)), height: 16 }; };

  return (
    <div className={'bd' + (bare ? ' bare' : '')}>
      <div className="bd-canvas" ref={cv} onPointerDown={downBg} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <div className="bd-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})` }}>
          {cards.map((c) => {
            const a = assetOf(c), src = srcOf(c), on = sel.includes(c.id);
            const video = a?.kind === 'video' || (c.pending?.kind === 'video');
            return (
              <div key={c.id} className={`bd-card${on ? ' on' : ''}${c.pending ? ' pending' : ''}${c.error ? ' failed' : ''}`} style={{ left: c.x, top: c.y, width: c.w }}
                onPointerDown={(e) => downCard(e, c)} onDoubleClick={() => c.asset_id && onOpen(c.asset_id)}>
                <div className="bd-img" style={{ aspectRatio: `${c.ratio || ratioOf(a)}` }}>
                  {c.pending ? <span className="bd-wait"><span className="spin" aria-hidden />{c.pending.kind === 'video' ? 'Making a clip…' : 'Making…'}</span>
                    : c.error ? <span className="bd-wait">{c.error}</span>
                    : src ? (video ? <video src={src} muted loop playsInline autoPlay /> : <img src={src} alt={a?.fields?.alt || a?.name || ''} draggable={false} />)
                    : <span className="bd-wait">Not in the library any more</span>}
                </div>
                {!c.pending && <div className="bd-cap"><span>{a?.name || c.name || ''}</span>{a?.status === 'draft' && <em>Draft</em>}</div>}
              </div>
            );
          })}
        </div>
        {bare && (
          <div className="bd-stage" onPointerDown={(e) => e.stopPropagation()}>
            <h2>What do you want to make?</h2>
            <div className="seg" role="group" aria-label="What to make">
              {(['design', 'photo', 'video'] as Mode[]).map((m) => <button key={m} type="button" aria-pressed={mode === m} onClick={() => { setMode(m); setSize(null); }}>{MODE_LABEL[m]}</button>)}
            </div>
            <div className="bd-stage-box">
              <textarea ref={stageBox} className="in" rows={3} autoFocus value={text} maxLength={1500} onChange={(e) => setText(e.target.value)}
                aria-label="Describe what to make"
                placeholder={mode === 'design' ? 'e.g. A LinkedIn banner for our autumn launch, warm and simple' : mode === 'photo' ? 'e.g. Our trainers on a wet London street at dusk, soft reflections' : 'e.g. Slow push-in on the product on a marble counter, morning light, café sounds'}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(); } }} />
            </div>
            <div className="cr-sizes" role="group" aria-label="Size">
              {mode !== 'video' && <button type="button" className="cr-size" aria-pressed={!size} onClick={() => setSize(null)}><b>Auto</b></button>}
              {sizes.map((f) => (
                <button key={f.label} type="button" className="cr-size" title={`${f.w}×${f.h}`} aria-pressed={!!size && size.w === f.w && size.h === f.h}
                  onClick={() => setSize(size && size.w === f.w && size.h === f.h ? null : { w: f.w, h: f.h })}>
                  <span className="cr-shape" style={shape(f.w, f.h)} aria-hidden /><b>{f.label}</b>
                </button>
              ))}
              {custom && <button type="button" className="cr-size" aria-pressed><span className="cr-shape" style={shape(custom.w, custom.h)} aria-hidden /><b>{custom.w}×{custom.h}</b></button>}
            </div>
            {!text.trim() && <div className="bd-sugs bd-stage-tries"><span>Try</span>{TRIES[mode].map((t) => <button key={t} type="button" onClick={() => { setText(t); stageBox.current?.focus(); }}>{t}</button>)}</div>}
            <div className="bd-stage-go">
              <span className="tip">{!can ? `${MODE_LABEL[mode]} isn’t switched on here yet, so Claude makes it with your brand kit and saves it to Mise.`
                : mode === 'design' ? 'Three options in your brand kit.' : mode === 'photo' ? 'Two takes in your brand’s style.' : 'A clip with sound, up to 8 seconds.'} Saved to Review as drafts.</span>
              <button className="primary" type="button" onClick={go}>{!can ? 'Make it in Claude' : mode === 'design' ? 'Design 3 options' : mode === 'photo' ? 'Make 2 photos' : 'Make a clip'} <span aria-hidden>→</span></button>
            </div>
            <div className="bd-stage-or"><span>or</span></div>
            <button type="button" className="bd-stage-add" onClick={() => setAdding(true)}>
              <span className="bd-stage-plus" aria-hidden>+</span>
              <span><b>Start from your files</b><small>Bring in photos, logos or products to edit, resize, restyle or animate</small></span>
            </button>
          </div>
        )}
        <div className="bd-top" onPointerDown={(e) => e.stopPropagation()}>
          <button className="btn quiet" type="button" onClick={onBack}>← Boards</button>
          <input className="bd-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} aria-label="Board name" />
        </div>
        {!bare && <div className="bd-tools" onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" className="btn" onClick={() => setAdding(true)}>+ Add files</button>
          <span className="bd-zoom">
            <button type="button" aria-label="Zoom out" onClick={() => zoom(1 / 1.25)}>−</button>
            <span>{Math.round(view.s * 100)}%</span>
            <button type="button" aria-label="Zoom in" onClick={() => zoom(1.25)}>+</button>
            <button type="button" onClick={fit}>Fit</button>
          </span>
        </div>}
      </div>

      {!bare && <aside className="bd-panel" aria-label="Make with AI">
        <div className="bd-thread" aria-live="polite">
          {!thread.length && (
            <div className="bd-hello">
              <b>What next?</b>
              <span>Select something on the board and say what to change, or describe something new. Everything is made in your brand and saved to Review as a draft.</span>
            </div>
          )}
          {thread.map((t) => (
            <div key={t.id} className={`bd-turn ${t.role}${t.error ? ' err' : ''}`}>
              {t.refs?.length ? <div className="bd-refs">{t.refs.slice(0, 4).map((id) => { const a = byId.get(id); const u = a && ((a.images?.email?.path && urls[a.images.email.path]) || urls[a.storage_path]); return u ? <img key={id} src={u} alt="" /> : null; })}</div> : null}
              <p>{t.text}</p>
              {t.made?.length ? <button type="button" className="linkish" onClick={() => setSel(t.made!.filter((id) => cards.some((c) => c.id === id)))}>Select {t.made.length === 1 ? 'it' : 'them'}</button> : null}
            </div>
          ))}
          <div ref={threadEnd} />
        </div>

        <div className="bd-compose">
          {selAssets.length ? (
            <div className="bd-ctx">
              {selAssets.slice(0, 5).map((a) => { const c = selected.find((x) => x.asset_id === a.id)!; const u = srcOf(c); return <span key={c.id} title={a.name}>{u && a.kind !== 'video' ? <img src={u} alt="" /> : null}<b>{a.name}</b></span>; })}
              {selAssets.length > 5 && <em>+{selAssets.length - 5}</em>}
              <button type="button" className="linkish" onClick={() => { setSel([]); setAsk(null); }}>Clear</button>
            </div>
          ) : (
            <div className="seg bd-modes" role="group" aria-label="What to make">
              {(['design', 'photo', 'video'] as Mode[]).map((m) => <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}>{m === 'design' ? 'Design' : m === 'photo' ? 'Photo' : 'Video'}</button>)}
            </div>
          )}

          {selImages.length > 0 && !ask && (
            <div className="bd-sugs">
              {SUGGESTED.filter((a) => a.batch || selImages.length === 1).map((a) => (
                <button key={a.id} type="button" title={`${a.blurb} · ${cost(a)}`} onClick={() => (a.kind === 'resize' ? runAction('resize') : setAsk(a))}>{a.title}</button>
              ))}
              {single && usable(single) && <button type="button" onClick={() => onOpen(single.id)} title="Crop, resize, rotate and adjust by hand">Crop and adjust</button>}
            </div>
          )}
          {ask && (
            <div className="bd-ask">
              <div className="bd-ask-h"><b>{ask.title}</b><span>{cost(ask)}</span><button type="button" className="linkish" onClick={() => setAsk(null)}>Back</button></div>
              <div className="bd-sugs">{(ask.choices || []).map((c) => <button key={c} type="button" onClick={() => { const a = ask; setAsk(null); runAction(a.id, c); }}>{c}</button>)}</div>
              {ask.ask && <span className="tip">Or type it below.</span>}
            </div>
          )}
          {!selAssets.length && !thread.length && (
            <div className="bd-sugs">{TRIES[mode].map((t) => <button key={t} type="button" onClick={() => runWords(t, mode)}>{t}</button>)}</div>
          )}

          <div className="bd-box">
            <textarea className="in" rows={2} value={text} onChange={(e) => setText(e.target.value)} maxLength={1500}
              placeholder={ask?.ask ? ask.ask.placeholder : selImages.length ? 'Say what to change, e.g. “make it autumn”' : mode === 'design' ? 'e.g. A LinkedIn banner for our autumn launch' : mode === 'photo' ? 'e.g. Our trainers on a wet street at dusk' : 'e.g. Slow push-in on the product, morning light'}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (ask?.ask && text.trim()) { const a = ask; setAsk(null); const t = text; setText(''); runAction(a.id, '', t); } else send(); } }} />
            <button className="primary" type="button" aria-label="Send" disabled={!text.trim()} onClick={() => { if (ask?.ask) { const a = ask; setAsk(null); const t = text; setText(''); runAction(a.id, '', t); } else send(); }}>↑</button>
          </div>
          <div className="bd-foot">
            <span className="tip">{selImages.length ? `Changes ${selImages.length === 1 ? 'the selected photo' : `${selImages.length} photos`}, 2 versions each` : mode === 'design' ? 'Three options in your brand kit' : mode === 'photo' ? 'Two takes, in your brand’s style' : 'An 8-second clip with sound'}</span>
            <button type="button" className="linkish" onClick={deleteBoard}>Delete board</button>
          </div>
        </div>
      </aside>}

      {adding && <AddFiles library={library} urls={urls} onClose={() => setAdding(false)} onAdd={(ids) => { const add = addAssets(ids); if (add[0]) autoName(add[0].name || 'Board'); setSel(add.map((a) => a.id)); setAdding(false); setTimeout(fit, 60); }} />}
    </div>
  );
}

// Pick files from the library to put on the board.
function AddFiles({ library, urls, onClose, onAdd }: { library: Asset[]; urls: Record<string, string>; onClose: () => void; onAdd: (ids: string[]) => void }) {
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<string[]>([]);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = library.filter((a) => ['image', 'logo', 'product', 'video'].includes(a.kind) && a.storage_path && (a.lifecycle || 'active') === 'active')
    .filter((a) => words.every((w) => `${a.name} ${(a.tags || []).join(' ')} ${a.pid || ''} ${a.description || ''}`.toLowerCase().includes(w))).slice(0, 120);
  const u = (a: Asset) => (a.kind !== 'video' && a.images?.email?.path && urls[a.images.email.path]) || urls[a.storage_path];
  return (
    <>
      <div className="scrim top" onClick={onClose} />
      <div className="modal top wide bd-add" role="dialog" aria-modal="true" aria-label="Add files to the board">
        <button className="x" type="button" aria-label="Close" onClick={onClose}><Icon.Close /></button>
        <h2>Add files</h2>
        <input className="in" type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your library" />
        <div className="bd-add-grid">
          {list.map((a) => (
            <button key={a.id} type="button" aria-pressed={pick.includes(a.id)} onClick={() => setPick((p) => (p.includes(a.id) ? p.filter((x) => x !== a.id) : [...p, a.id]))} title={a.name}>
              {a.kind === 'video' ? <video src={u(a)} muted preload="metadata" /> : <img src={u(a)} alt="" loading="lazy" />}
              <span>{a.name}</span>
            </button>
          ))}
          {!list.length && <p className="tip">Nothing matches.</p>}
        </div>
        <div className="actions"><button className="primary" type="button" disabled={!pick.length} onClick={() => onAdd(pick)}>{pick.length ? `Add ${pick.length}` : 'Add'}</button><button className="btn quiet" type="button" onClick={onClose}>Cancel</button></div>
      </div>
    </>
  );
}
