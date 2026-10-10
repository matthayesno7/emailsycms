'use client';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { EXTEND_SHAPES, SMART_SIZES, SOCIAL_SIZES, SUGGESTED, TOOL_DESIGNS, actionById, actionDesigns, type ActionDef, type ActionId, type ToolId } from '@/lib/actions';
import { PRODUCT_INFO_H, bounds, itemBox, itemHeight, place, uid, type BoardItem, type BoardText, type DesignState, type Turn } from '@/lib/boards';
import { productAsBlock, productCopy, productPatch, type ProductCopy } from '@/lib/products';
import { BLOCK_TYPES } from '@/lib/blockTypes';
import { FitPreview, Preview } from './BlockEditor';
import { JOBS, VIDEO_JOB, modelName, nearestAspect, type Purpose } from '@/lib/models';
import { FORMATS as DESIGN_FORMATS, assetsUsed, formatFor, type Spec } from '@/lib/design';
import { exportPng } from '@/lib/exportDesign';
import { emailRendition } from '@/lib/renditions';
import { loadImg } from '@/lib/images';
import { runKey } from '@/lib/plans';
import { openInClaude } from '@/lib/openClaude';
import type { BrandKit } from '@/lib/brandKit';
import DesignCanvas, { type StudioBrand } from './DesignCanvas';
import ImageEditor, { type EditResult } from './ImageEditor';
import { openUpgrade } from './Billing';
import { Icon } from './icons';
import type { Asset, Ws } from './Library';

// A Create board: a canvas of files and everything made from them, with AI beside it.
// Left: the library, to drag files in. Middle: the canvas, with a toolbar on whatever is selected.
// Right: the chat. What AI makes stays on the board until someone saves it to the library.
export type Mode = 'design' | 'photo' | 'video';
// How a board starts: with files (and optionally what to do with them), or with words.
// draft: put the words in the prompt for the person to send, rather than running them.
// designs: saved designs (asset ids) to put on the board as editable designs.
// tool: open a tool on the first file straight away ('crop' from the asset page's Edit).
export type Start = { mode: Mode; prompt?: string; size?: { w: number; h: number }; assets?: string[]; designs?: string[]; draft?: boolean; tool?: 'crop' };
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
// The board's library panel: what kind of file to show.
const LIB_TABS: [string, string][] = [['all', 'All'], ['image', 'Photos'], ['product', 'Products'], ['logo', 'Logos'], ['design', 'Designs'], ['video', 'Videos']];
// Smart resize: the sizes ticked to start with.
const SMART_DEFAULT = ['email-hero', 'ig-post', 'square', 'story', 'linkedin-post'];
const SHORTCUTS: [string, string][] = [
  ['V', 'Select'], ['H', 'Hand: drag to move around'], ['T', 'Add text'], ['Space + drag', 'Move around'],
  ['⌘ Z / ⇧⌘ Z', 'Undo / redo'], ['⌘ D', 'Duplicate'], ['⌘ G / ⇧⌘ G', 'Group / ungroup'], ['⌘ A', 'Select all'],
  [']  /  [', 'Bring to front / send to back'], ['Arrows', 'Nudge (⇧ for 10)'], ['⇧ 1', 'Fit everything'], ['+ / −', 'Zoom'],
  ['Delete', 'Remove from the board'], ['Esc', 'Clear the selection'], ['?', 'These shortcuts'],
];
const usable = (a?: Asset | null) => !!a && ['image', 'logo', 'product'].includes(a.kind) && !!a.storage_path && !/svg|gif|video/.test(a.mime || '');
const now = () => new Date().toISOString();
const isDesignAsset = (a: Asset) => a.provenance?.via === 'studio' && !!a.provenance?.spec;

export default function Board({ boardId, ws, userId, supabase, items: library, urls, plan, caps, brand, fonts, designSrc, kit, start, onStarted, onBack, onOpen, gate, onClaude, onLibrary, onPatchAsset, onUpload, onSaveEdit, toast }: {
  boardId: string; ws: Ws; userId: string; supabase: SupabaseClient; items: Asset[]; urls: Record<string, string>; plan: string;
  caps: Caps; onClaude: (prompt: string) => void;
  brand: StudioBrand; fonts: string[]; designSrc: (assetId: string) => string | undefined; // how designs are drawn
  kit?: BrandKit | null; // sizes and colours for the crop tool
  start?: Start | null; onStarted?: () => void;
  onBack: () => void; onOpen: (id: string) => void;
  gate: (brief: string) => boolean; // false: the free run is used (the upgrade pop-up is open)
  onLibrary: () => void; // something was saved to the library
  onPatchAsset?: (id: string, patch: Record<string, any>) => Promise<boolean>; // a product's copy, edited right here
  onUpload?: (files: File[]) => Promise<Asset[]>; // files from the computer, into the library
  onSaveEdit?: (id: string, r: EditResult, asCopy: boolean) => Promise<boolean>; // crop and adjust, saved to a library file
  toast: (m: string) => void;
}) {
  const [name, setName] = useState('Untitled board');
  const [cards, setCardsRaw] = useState<BoardItem[]>([]);
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
  const chatBox = useRef<HTMLTextAreaElement>(null);
  const [editing, setEditing] = useState<string | null>(null); // the design or text whose words are being edited in place
  const [pdraft, setPdraft] = useState<{ id: string; v: ProductCopy; saved?: boolean } | null>(null); // the selected product's copy, as it's typed
  const pname = useRef<HTMLInputElement>(null);
  const [tool, setTool] = useState<'select' | 'hand' | 'text'>('select');
  const [libOpen, setLibOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(true);
  const [full, setFull] = useState(false);
  const [keys, setKeys] = useState(false); // the shortcuts sheet
  const [purpose, setPurpose] = useState<Purpose>('auto'); // the model picked in the chat
  const [modelOpen, setModelOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [panel, setPanel] = useState<null | { tool: ToolId | 'crop'; card: string }>(null); // a tool's options, open on one item
  const [busy, setBusy] = useState<string[]>([]); // items a tool is working on
  const [mention, setMention] = useState<string | null>(null); // the @ search typed in the chat
  // A new board takes its name from the first thing made or added to it.
  const autoName = (t: string) => setName((n) => (!n.trim() || n === 'Untitled board' || n === 'New board' ? t.trim().replace(/\s+/g, ' ').slice(0, 60) : n));
  const cv = useRef<HTMLDivElement>(null);
  const threadEnd = useRef<HTMLDivElement>(null);
  const cardsRef = useRef(cards); cardsRef.current = cards;
  const shown = useRef(cards); shown.current = cards; // what's on screen (cardsRef can run ahead while placing new things)

  // ---------- undo and redo: every change to what's on the board ----------
  const past = useRef<BoardItem[][]>([]);
  const future = useRef<BoardItem[][]>([]);
  const [, bump] = useState(0);
  const snap = () => { if (past.current[past.current.length - 1] !== shown.current) past.current = [...past.current.slice(-59), shown.current]; future.current = []; bump((n) => n + 1); };
  const setCards = (fn: BoardItem[] | ((all: BoardItem[]) => BoardItem[]), record = true) => {
    if (record) snap();
    setCardsRaw(fn as any);
  };
  function undo() {
    const prev = past.current.pop(); if (!prev) return;
    future.current.push(cardsRef.current); setCardsRaw(prev); bump((n) => n + 1);
  }
  function redo() {
    const next = future.current.pop(); if (!next) return;
    past.current.push(cardsRef.current); setCardsRaw(next); bump((n) => n + 1);
  }

  // ---------- load and save ----------
  useEffect(() => {
    let off = false;
    supabase.from('boards').select('*').eq('id', boardId).maybeSingle().then(({ data }) => {
      if (off || !data) return;
      // A design that was still being made when the board was left: it won't arrive now.
      const kinds = new Map(library.map((x) => [x.id, x.kind]));
      const items = (data.items || []).map((c: BoardItem) => (!c.design ? (c.asset_id && !c.product && kinds.get(c.asset_id) === 'product' ? { ...c, product: true } : c)
        : c.design.status === 'refining' ? { ...c, design: { ...c.design, status: 'ready' as const } }
        : c.design.status === 'loading' ? { ...c, design: { ...c.design, status: 'error' as const, error: 'This one didn’t finish. Try again.' } } : c));
      setName(data.name); setCardsRaw(items); setThread(data.thread || []); setLoaded(true);
    });
    return () => { off = true; };
  }, [boardId, supabase]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      supabase.from('boards').update({ name: name.trim() || 'Untitled board', items: cards, thread: thread.slice(-200), updated_at: now() }).eq('id', boardId).then(({ error }) => { if (error) console.error('[board] save', error.message); });
    }, 700);
    return () => clearTimeout(t);
  }, [cards, thread, name, loaded, boardId, supabase]);

  // ---------- files: the library, plus the board's own (made here, not saved yet) ----------
  const [extra, setExtra] = useState<Record<string, Asset>>({});
  const [xurls, setXurls] = useState<Record<string, string>>({});
  const libIds = useMemo(() => new Set(library.map((a) => a.id)), [library]);
  const byId = useMemo(() => { const m = new Map(library.map((a) => [a.id, a])); for (const [k, v] of Object.entries(extra)) if (!m.has(k)) m.set(k, v); return m; }, [library, extra]);
  const U = (p?: string | null) => (p ? urls[p] || xurls[p] : undefined);
  async function loadExtra(ids: string[]) {
    const want = [...new Set(ids)].filter((id) => id && !libIds.has(id));
    if (!want.length) return;
    const r = await fetch('/api/board/files', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace_id: ws.id, action: 'rows', asset_ids: want }) }).catch(() => null);
    const j = await r?.json().catch(() => null);
    if (!j?.rows) return;
    setExtra((x) => { const n = { ...x }; for (const row of j.rows) n[row.id] = row; return n; });
    setXurls((x) => ({ ...x, ...(j.urls || {}) }));
  }
  // Files on the board that aren't in the library: made here and not saved yet (or saved since).
  useEffect(() => { if (loaded) loadExtra(cards.map((c) => c.asset_id || '').filter((id) => id && !byId.has(id))); }, [loaded, cards.length, library.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const unsaved = (a?: Asset | null) => !!a && (a as any).on_board === true && !libIds.has(a.id);

  const srcOf = (c: BoardItem) => {
    const a = c.asset_id ? byId.get(c.asset_id) : null;
    if (a) return (a.kind !== 'video' && U(a.images?.email?.path)) || U(a.storage_path) || c.url || null;
    return c.url || null;
  };
  const assetOf = (c: BoardItem) => (c.asset_id ? byId.get(c.asset_id) || null : null);
  const selCards = cards.filter((c) => sel.includes(c.id));
  const selected = selCards.filter((c) => c.asset_id && !c.pending);
  const selAssets = selected.map(assetOf).filter(Boolean) as Asset[];
  const selImages = selected.filter((c) => usable(assetOf(c)) && !c.design);
  const selDesigns = selCards.filter((c) => c.design?.spec && c.design.status === 'ready');
  const selTexts = selCards.filter((c) => c.text);
  // One product selected: its card copy is edited in the panel, live on the board.
  const selProduct = selAssets.length === 1 && selAssets[0].kind === 'product' && !selDesigns.length ? selAssets[0] : null;
  useEffect(() => {
    if (!selProduct) { setPdraft(null); return; }
    setPdraft((d) => (d?.id === selProduct.id ? d : { id: selProduct.id, v: productCopy(selProduct) }));
  }, [selProduct?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const withDraft = (a: Asset): Asset => (pdraft?.id === a.id ? { ...a, name: pdraft.v.name, price: pdraft.v.price, link: pdraft.v.link, fields: { ...(a.fields || {}), eyebrow: pdraft.v.eyebrow, description: pdraft.v.description, cta: pdraft.v.cta } } : a);
  async function saveProduct() {
    if (!pdraft || !onPatchAsset) return;
    const a = byId.get(pdraft.id); if (!a) return;
    if (JSON.stringify(productCopy(a)) === JSON.stringify(pdraft.v)) return;
    if (!pdraft.v.name.trim()) { toast('A product needs a name.'); return; }
    const ok = await onPatchAsset(a.id, productPatch(a, pdraft.v));
    if (ok) setPdraft((d) => (d && d.id === a.id ? { ...d, saved: true } : d));
  }
  // Selecting photos: what you type changes them, unless you choose Design or Video.
  const hadImages = useRef(false);
  useEffect(() => {
    const has = selImages.length > 0;
    if (has && !hadImages.current) setMode((m) => (m === 'design' ? 'photo' : m));
    hadImages.current = has;
  }, [selImages.length]);
  useEffect(() => { setToolsOpen(false); setPanel((p) => (p && sel.includes(p.card) ? p : null)); }, [sel.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const fit = useCallback(() => {
    const el = cv.current; if (!el) return;
    const b = bounds(cardsRef.current);
    const s = Math.min(1.2, Math.max(0.15, Math.min((el.clientWidth - 120) / Math.max(b.w, 1), (el.clientHeight - 160) / Math.max(b.h, 1))));
    setView({ s, x: (el.clientWidth - b.w * s) / 2 - b.x * s, y: (el.clientHeight - b.h * s) / 2 - b.y * s });
  }, []);
  useEffect(() => { if (loaded) setTimeout(fit, 50); }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { threadEnd.current?.scrollIntoView({ block: 'end' }); }, [thread.length]);
  // Full screen hides Mise's own menu too.
  useEffect(() => {
    if (full) document.documentElement.setAttribute('data-board-full', ''); else document.documentElement.removeAttribute('data-board-full');
    const t = setTimeout(() => fit(), 220);
    return () => clearTimeout(t);
  }, [full]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => document.documentElement.removeAttribute('data-board-full'), []);

  const say = (t: Omit<Turn, 'id' | 'at'>) => setThread((all) => [...all, { id: uid(), at: now(), ...t }]);
  const ratioOf = (a?: Asset | null) => (a?.width && a?.height ? a.width / a.height : 1);
  const toWorld = (clientX: number, clientY: number) => {
    const r = cv.current!.getBoundingClientRect();
    return { x: (clientX - r.left - view.x) / view.s, y: (clientY - r.top - view.y) / view.s };
  };

  function addAssets(ids: string[], from?: BoardItem | null, at?: { x: number; y: number }) {
    const list = ids.map((id) => byId.get(id)).filter(Boolean) as Asset[];
    if (!list.length) return [];
    let spots = place(cardsRef.current, list.map(ratioOf), from, list.map((a) => (a.kind === 'product' ? PRODUCT_INFO_H : 0)));
    if (at) spots = spots.map((p, i) => ({ ...p, x: at.x + i * 30 - p.w / 2, y: at.y + i * 30 - p.w / p.ratio / 2 }));
    const add: BoardItem[] = list.map((a, i) => (isDesignAsset(a)
      ? { id: uid(), asset_id: a.id, name: a.name, ...spots[i], ratio: (a.provenance.size?.w || a.width || 2) / (a.provenance.size?.h || a.height || 1), design: { spec: a.provenance.spec, size: a.provenance.size || { w: a.width || 1200, h: a.height || 600 }, brief: a.provenance.prompt || a.name, run: runKey(a.provenance.prompt || a.name), status: 'ready' as const } }
      : { id: uid(), asset_id: a.id, name: a.name, ...spots[i], ...(a.kind === 'product' ? { product: true } : {}) }));
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
    }, false);
    loadExtra(got.map((g) => g.id));
  }
  const drop = (hs: BoardItem[]) => setCards((all) => all.filter((c) => !hs.some((h) => h.id === c.id)), false);

  async function post(url: string, body: any) {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace_id: ws.id, ...body }) }).catch(() => null);
    const j: any = (await r?.json().catch(() => null)) || {};
    const status = r?.status || 0;
    // No explanation from the server: say what we can from the status.
    if (!r?.ok && !j.error) j.error = !r ? 'Couldn’t reach Mise. Check your connection and try again.'
      : status === 401 ? 'You’ve been signed out. Reload the page and sign in again.'
      : status === 502 || status === 503 || status === 504 ? 'Mise took too long to answer. Try again in a moment.'
      : `Couldn’t make that (error ${status}). Try again.`;
    return { ok: !!r?.ok, status, j };
  }
  const blocked = (status: number, j: any, reason: 'media' | 'edit') => {
    if (status === 402 || j?.code === 'upgrade') { openUpgrade({ reason }); return true; }
    return false;
  };
  const KEEP_NOTE = 'They stay on this board until you save them.';

  async function runAction(id: ActionId, choice = '', detail = '', from?: BoardItem[]) {
    const def = actionById(id); if (!def) return;
    const sources = (def.batch ? (from || selImages) : (from || selImages).slice(0, 1)).slice(0, 10);
    if (!sources.length) { toast('Select a photo on the board first.'); return; }
    if (plan === 'free') { openUpgrade({ reason: def.kind === 'resize' ? 'edit' : 'media' }); return; }
    say({ role: 'you', text: id === 'edit' ? detail : `${def.title}${choice ? `: ${choice}` : ''}${detail ? ` (${detail})` : ''}`, refs: sources.map((s) => s.asset_id!) });
    if (def.kind === 'video') {
      const src = sources[0], a = assetOf(src);
      const hs = holders(src, [(a?.width || 16) < (a?.height || 9) ? 9 / 16 : 16 / 9], { kind: 'video', label: choice || 'Clip' });
      const { ok, status, j } = await post('/api/make/action', { action: id, asset_ids: [src.asset_id], choice, detail, board: true });
      if (blocked(status, j, 'media')) { drop(hs); return; }
      if (!ok) { drop(hs); say({ role: 'mise', text: j.error || 'Couldn’t start the clip.', error: true }); return; }
      setCards((all) => all.map((c) => (c.id === hs[0].id ? { ...c, pending: { kind: 'video', job: j.job, label: choice || 'Clip' } } : c)), false);
      say({ role: 'mise', text: `Making a clip with ${modelName(j.model) || 'Veo'}. It takes one to three minutes and appears here. ${KEEP_NOTE.replace('They stay', 'It stays').replace('them', 'it')}`, made: hs.map((h) => h.id) });
      return;
    }
    const per = def.kind === 'resize' ? SOCIAL_SIZES.map((s) => s.w / s.h) : Array(def.takes || 1).fill(0).map(() => 0);
    const groups = sources.map((s) => holders(s, per.map((r) => r || ratioOf(assetOf(s))), { kind: 'photo', label: def.kind === 'resize' ? 'Resizing' : choice || detail || def.title }));
    const { ok, status, j } = await post('/api/make/action', { action: id, asset_ids: sources.map((s) => s.asset_id), choice, detail, board: true, purpose });
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
        : def.kind === 'resize' ? `${n} ${n === 1 ? 'copy' : 'copies'} for social, next to the original${sources.length > 1 ? 's' : ''}. ${KEEP_NOTE}`
        : `${n} new ${n === 1 ? 'version' : 'versions'} with ${modelName(j.model) || 'Mise'}${j.designs ? ` (${j.designs} design${j.designs === 1 ? '' : 's'})` : ''}. ${KEEP_NOTE}${errs.length ? ` ${errs.length} couldn’t be made.` : ''}`,
      error: !n,
    });
  }

  // ---------- the Tools menu: hands-on edits of one picture ----------
  async function runTool(t: ToolId, c: BoardItem, opts: Record<string, unknown> = {}, label = '') {
    const a = assetOf(c); if (!a) return;
    if (plan === 'free' && t !== 'readtext') { openUpgrade({ reason: 'edit' }); return; }
    setPanel(null);
    const sizes = t === 'smartresize' ? SMART_SIZES.filter((s) => (opts.sizes as string[] || []).includes(s.id)) : [];
    const ratios = t === 'smartresize' ? sizes.map((s) => s.w / s.h)
      : t === 'extend' ? [(() => { const sh = EXTEND_SHAPES.find((x) => x.id === opts.shape); const [w, h] = (sh?.aspect || '16:9').split(':').map(Number); return w / h; })()]
      : [ratioOf(a)];
    const hs = holders(c, ratios, { kind: 'photo', label: label || 'Working…' });
    setBusy((b) => [...b, c.id]);
    say({ role: 'you', text: label, refs: [a.id] });
    const { ok, status, j } = await post('/api/board/tool', { tool: t, asset_id: a.id, purpose, ...opts });
    setBusy((b) => b.filter((x) => x !== c.id));
    if (blocked(status, j, 'edit')) { drop(hs); return; }
    if (!ok) { drop(hs); say({ role: 'mise', text: j.error, error: true }); return; }
    fill(hs, j.assets || []);
    const n = (j.assets || []).length;
    say({ role: 'mise', made: hs.slice(0, n).map((h) => h.id), error: !n, text: n ? `Done${j.designs ? ` (${j.designs} design${j.designs === 1 ? '' : 's'})` : ''}. ${n === 1 ? 'It’s next to the original' : `${n} versions, next to the original`}. ${KEEP_NOTE}` : 'Nothing came back. Try again.' });
  }
  // Crop and adjust: in a focused editor over the board. A library file can be saved as its new version.
  const [cropFor, setCropFor] = useState<string | null>(null);
  async function cropSaved(c: BoardItem, r: EditResult, asVersion: boolean) {
    const a = assetOf(c); if (!a) return false;
    if (asVersion && onSaveEdit && libIds.has(a.id)) {
      const ok = await onSaveEdit(a.id, r, false);
      if (ok) { setCropFor(null); toast('Saved as a new version. The previous one is kept.'); }
      return ok;
    }
    // Otherwise a new file, on the board in the original's place (undo brings the original back).
    const ext = r.mime.includes('png') ? 'png' : r.mime.includes('webp') ? 'webp' : 'jpg';
    const path = `${ws.id}/edits/${crypto.randomUUID()}.${ext}`;
    const up = await supabase.storage.from('assets').upload(path, r.blob, { contentType: r.mime });
    if (up.error) { toast('Couldn’t upload the edit.'); return false; }
    const { ok, j } = await post('/api/board/files', { action: 'add', storage_path: path, mime: r.mime, width: r.width, height: r.height, bytes: r.blob.size, name: `${a.name} (edited)`, from: a.id, edit: r.note });
    if (!ok || !j.row) { toast(j.error || 'Couldn’t save the edit.'); return false; }
    setExtra((x) => ({ ...x, [j.row.id]: j.row })); if (j.url) setXurls((x) => ({ ...x, [path]: j.url }));
    setCards((all) => all.map((x) => (x.id === c.id ? { ...x, asset_id: j.row.id, name: j.row.name, ratio: r.width / r.height, product: false, measured: undefined } : x)));
    setCropFor(null);
    return true;
  }

  // How a file is named to the AI: products bring their name, price and copy, so designs can use them.
  const describe = (a: Asset) => a.kind === 'product'
    ? `the product “${a.name}”${a.price ? `, price ${a.price}` : ''}${a.fields?.eyebrow ? `, label “${a.fields.eyebrow}”` : ''}${a.fields?.description ? `, description “${String(a.fields.description).slice(0, 200)}”` : ''}${a.fields?.cta ? `, button “${a.fields.cta}”` : ''} (its photo)`
    : `the photo “${a.name}”`;

  // ---------- designs ----------
  const setDesign = (id: string, p: Partial<DesignState> | ((d: DesignState) => Partial<DesignState>), record = false) =>
    setCards((all) => all.map((c) => (c.id === id && c.design ? { ...c, design: { ...c.design, ...(typeof p === 'function' ? p(c.design) : p) } } : c)), record);
  async function designCall(d: Pick<DesignState, 'brief' | 'run' | 'size'>, body: Record<string, any>): Promise<{ spec?: Spec; error?: string }> {
    try {
      const r = await fetch('/api/design', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace_id: ws.id, brief: d.brief, run: d.run, size: d.size, ...body }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (j.code === 'upgrade') window.dispatchEvent(new CustomEvent('mise:upgrade', { detail: { reason: j.reason } }));
        if (j.code === 'limit') window.dispatchEvent(new CustomEvent('mise:limit', { detail: { workspace_id: ws.id, message: j.error, reason: j.reason } }));
        return { error: j.error || 'Something went wrong.' };
      }
      return { spec: j.spec };
    } catch { return { error: 'Couldn’t reach Mise.' }; }
  }
  // Three directions for a brief, side by side, each shown as soon as it's ready.
  async function runDesign(brief: string, size: { w: number; h: number }) {
    if (!gate(brief)) return;
    const run = runKey(brief);
    const spots = place(cardsRef.current, [0, 1, 2].map(() => size.w / size.h));
    const hs: BoardItem[] = spots.map((p, i) => ({ id: uid(), ...p, design: { size, brief, run, variant: i, status: 'loading' } }));
    cardsRef.current = [...cardsRef.current, ...hs];
    setCards((all) => [...all, ...hs]);
    setTimeout(fit, 60);
    const got = await Promise.all(hs.map(async (h, i) => {
      const r = await designCall(h.design!, { variant: i });
      setDesign(h.id, r.spec ? { status: 'ready', spec: r.spec } : { status: 'error', error: r.error });
      return !!r.spec;
    }));
    const n = got.filter(Boolean).length;
    say({ role: 'mise', made: hs.map((h) => h.id), error: !n,
      text: n ? `${n} design${n === 1 ? '' : 's'} in your brand. Select one to change it, double-click to edit the words, and save the ones you want to your library.`
        : 'The designs didn’t come back. Try again, or reword it.' });
  }
  async function retryDesign(c: BoardItem) {
    const d = c.design; if (!d) return;
    setDesign(c.id, { status: 'loading', error: undefined });
    const r = await designCall(d, d.spec ? { base: d.spec } : { variant: d.variant || 0 });
    setDesign(c.id, r.spec ? { status: 'ready', spec: r.spec } : { status: 'error', error: r.error });
  }
  async function refineDesigns(list: BoardItem[], instruction: string) {
    say({ role: 'you', text: instruction, refs: list.map((c) => c.asset_id).filter(Boolean) as string[] });
    list.forEach((c) => setDesign(c.id, { status: 'refining' }));
    const res = await Promise.all(list.map(async (c) => {
      const d = c.design!, base = d.spec!;
      const r = await designCall(d, { base, instruction });
      setDesign(c.id, (cur) => (r.spec ? { status: 'ready', spec: r.spec, history: [...(cur.history || []), base].slice(-20), dirty: true } : { status: 'ready' }));
      return r;
    }));
    const ok = res.filter((r) => r.spec).length;
    say({ role: 'mise', made: list.map((c) => c.id), error: !ok, text: ok ? `Changed ${ok === 1 ? 'it' : `${ok} designs`}. Undo goes back a step. Save when you’re happy.` : res[0]?.error || 'Couldn’t make that change.' });
  }
  function everySize(c: BoardItem) {
    const d = c.design; if (!d?.spec) return;
    const others = DESIGN_FORMATS.filter((f) => !f.video && !(f.w === d.size.w && f.h === d.size.h));
    const spots = place(cardsRef.current, others.map((f) => f.w / f.h), c);
    const hs: BoardItem[] = spots.map((p, i) => ({ id: uid(), ...p, design: { size: { w: others[i].w, h: others[i].h }, brief: d.brief, run: d.run, label: others[i].label, status: 'loading' } }));
    cardsRef.current = [...cardsRef.current, ...hs];
    setCards((all) => [...all, ...hs]);
    say({ role: 'you', text: `Every size: ${d.spec.name}` });
    Promise.all(hs.map(async (h) => {
      const r = await designCall(h.design!, { base: d.spec });
      setDesign(h.id, r.spec ? { status: 'ready', spec: r.spec } : { status: 'error', error: r.error });
    })).then(() => say({ role: 'mise', made: hs.map((h) => h.id), text: `${others.length} more sizes, next to the original. Save the ones you need.` }));
  }
  function undoDesign(c: BoardItem) {
    const h = c.design?.history || []; const prev = h[h.length - 1];
    if (prev) setDesign(c.id, { spec: prev, history: h.slice(0, -1), dirty: true }, true);
  }
  function designText(c: BoardItem, i: number, t: string) {
    const d = c.design; if (!d?.spec || !t) return;
    const layers = d.spec.layers.map((l, j) => (j === i && (l.type === 'text' || l.type === 'button') ? { ...l, text: t } : l));
    if (JSON.stringify(layers) !== JSON.stringify(d.spec.layers)) setDesign(c.id, { spec: { ...d.spec, layers }, history: [...(d.history || []), d.spec].slice(-20), dirty: true }, true);
  }
  const png = (d: DesignState) => exportPng({ spec: d.spec!, size: d.size, brand, srcOf: designSrc, fonts });
  const [saving, setSaving] = useState<string[]>([]);
  // Save to the library: a new file the first time, a new version of it after that (the old one is kept).
  async function saveDesign(c: BoardItem): Promise<string | null> {
    const d = c.design; if (!d?.spec) return null;
    if (c.asset_id && !d.dirty) return c.asset_id;
    setSaving((s) => [...s, c.id]);
    try {
      const blob = await png(d);
      const path = `${ws.id}/generated/${crypto.randomUUID()}.png`;
      const up = await supabase.storage.from('assets').upload(path, blob, { contentType: 'image/png' });
      if (up.error) throw up.error;
      const url = URL.createObjectURL(blob);
      let email: any = null;
      try { email = await emailRendition(supabase, ws.id, await loadImg(url), { mime: 'image/png', bytes: blob.size }); } catch {} finally { URL.revokeObjectURL(url); }
      const file = { storage_path: path, mime: 'image/png', width: d.size.w, height: d.size.h, bytes: blob.size, images: email ? { email } : {} };
      const alt = d.spec.layers.filter((l) => l.type === 'text').map((l: any) => l.text).join('. ').slice(0, 150);
      let id = c.asset_id || null;
      if (id) {
        const prev = byId.get(id);
        const { error } = await supabase.rpc('asset_new_version', { p_asset: id, p_file: file, p_note: 'Edited on a Create board',
          p_provenance: { ...(prev?.provenance || {}), via: 'studio', spec: d.spec, size: d.size, source_asset_ids: assetsUsed(d.spec), edited_at: now() } });
        if (error) throw error;
        await supabase.from('assets').update({ fields: { ...(prev?.fields || {}), alt } }).eq('id', id);
        toast(`Saved as a new version of “${d.spec.name}”. The previous one is kept.`);
      } else {
        const { data, error } = await supabase.from('assets').insert({
          workspace_id: ws.id, kind: 'image', name: d.spec.name, ...file, origin: 'generated', status: 'approved', created_by: userId, fields: { alt },
          provenance: { via: 'studio', prompt: d.brief, model: 'Mise Studio (Claude)', spec: d.spec, size: d.size, source_asset_ids: assetsUsed(d.spec), generated_at: now() },
        }).select('id').single();
        if (error) throw error;
        id = data.id as string;
        toast('Saved to your library');
      }
      setCards((all) => all.map((x) => (x.id === c.id ? { ...x, asset_id: id!, name: d.spec!.name, design: { ...x.design!, dirty: false } } : x)), false);
      onLibrary();
      return id;
    } catch (err: any) {
      toast(`Couldn’t save${err?.message ? `: ${err.message}` : ''}`);
      return null;
    } finally { setSaving((s) => s.filter((x) => x !== c.id)); }
  }
  async function downloadDesign(c: BoardItem) {
    const d = c.design; if (!d?.spec) return;
    try {
      const blob = await png(d);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `${d.spec.name.replace(/[^\w-]+/g, '-').toLowerCase()}-${d.size.w}x${d.size.h}.png`;
      document.body.appendChild(a); a.click(); a.remove();
    } catch (err: any) { toast(err?.message || 'Couldn’t export.'); }
  }
  async function designToFigma(c: BoardItem) {
    const id = await saveDesign(c); if (!id) return;
    const prompt = `Rebuild my Mise design "${c.design!.spec!.name}" (asset id ${id}) in Figma as editable layers${ws.figma_file_url ? ` in ${ws.figma_file_url}` : ''}: live text in our brand fonts, our brand kit colours, and the photos pushed from Mise. Its layout is in the asset's provenance.spec.`;
    try { await navigator.clipboard.writeText(prompt); } catch {}
    openInClaude(prompt);
  }

  // ---------- saving what was made here ----------
  async function keep(list: BoardItem[]) {
    const designs = list.filter((c) => c.design?.spec && (!c.asset_id || c.design.dirty));
    const files = list.filter((c) => !c.design && unsaved(assetOf(c)));
    for (const c of designs) await saveDesign(c);
    if (files.length) {
      setSaving((s) => [...s, ...files.map((c) => c.id)]);
      const { ok, j } = await post('/api/board/files', { action: 'keep', asset_ids: files.map((c) => c.asset_id) });
      setSaving((s) => s.filter((x) => !files.some((c) => c.id === x)));
      if (!ok) { toast(j.error || 'Couldn’t save.'); return; }
      setExtra((x) => { const n = { ...x }; for (const id of j.kept || []) if (n[id]) n[id] = { ...n[id], on_board: false } as any; return n; });
      onLibrary();
      toast(`${(j.kept || []).length === 1 ? 'Saved' : `${(j.kept || []).length} saved`} to your library. What AI made waits in Review.`);
    }
  }
  const needsSave = (c: BoardItem) => (c.design?.spec ? !c.asset_id || !!c.design.dirty : unsaved(assetOf(c)));
  // Take items off the board. Files made here and never saved are deleted (after asking).
  function remove(ids: string[]) {
    const gone = cardsRef.current.filter((c) => ids.includes(c.id));
    const lost = gone.filter(needsSave);
    if (lost.length && !confirm(`${lost.length === 1 ? 'One of these isn’t' : `${lost.length} of these aren’t`} saved to your library, so ${lost.length === 1 ? 'it' : 'they'}’ll be gone. Remove anyway?`)) return;
    const scratch = gone.filter((c) => !c.design && unsaved(assetOf(c)) && !cardsRef.current.some((x) => !ids.includes(x.id) && x.asset_id === c.asset_id)).map((c) => c.asset_id!);
    setCards((all) => all.filter((c) => !ids.includes(c.id)));
    setSel([]); setEditing(null);
    trash.current.push(...scratch); // deleted when the board closes, unless undo brought them back
  }
  const trash = useRef<string[]>([]);
  useEffect(() => {
    const flush = () => {
      const gone = [...new Set(trash.current)].filter((id) => !cardsRef.current.some((c) => c.asset_id === id));
      trash.current = [];
      if (gone.length) fetch('/api/board/files', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace_id: ws.id, action: 'discard', asset_ids: gone }) }).catch(() => {});
    };
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); flush(); };
  }, [ws.id]);

  // shown: what the person typed, when the prompt sent to the AI has more in it (product details).
  async function runWords(prompt: string, m: Mode, sz0?: { w: number; h: number }, shown?: string) {
    const p = prompt.trim(); if (!p) return;
    if (!(m === 'design' ? caps.design : m === 'photo' ? caps.image : caps.video)) { onClaude(p); return; } // not switched on here: Claude makes it
    say({ role: 'you', text: shown || p, refs: shown ? selAssets.map((a) => a.id) : undefined });
    autoName(shown || p);
    if (m === 'design') { await runDesign(p, sz0 || formatFor(p)); return; }
    if (plan === 'free') { openUpgrade({ reason: 'media' }); return; }
    if (m === 'video') {
      const vertical = sz0 ? sz0.h > sz0.w : /reel|story|stories|vertical|tiktok|9:16/i.test(p);
      const hs = holders(null, [vertical ? 9 / 16 : 16 / 9], { kind: 'video', label: 'Clip' });
      const { ok, status, j } = await post('/api/make/video', { prompt: p, aspect: vertical ? '9:16' : '16:9', seconds: 8, board: true });
      if (blocked(status, j, 'media')) { drop(hs); return; }
      if (!ok) { drop(hs); say({ role: 'mise', text: j.error || 'Couldn’t start the clip.', error: true }); return; }
      setCards((all) => all.map((c) => (c.id === hs[0].id ? { ...c, pending: { kind: 'video', job: j.job, label: 'Clip' } } : c)), false);
      say({ role: 'mise', text: `Making a clip with ${modelName(j.model) || 'Veo'}. It takes one to three minutes.`, made: hs.map((h) => h.id) });
      return;
    }
    // A size in the words (Instagram, story, banner…) sets the shape; otherwise a 4:3 photo.
    const sz = sz0 || (/email|banner|hero|linkedin|instagram|insta|stor(y|ies)|reel|tiktok|square|\bads?\b|facebook/i.test(p) ? formatFor(p) : { w: 4, h: 3 });
    const aspect = nearestAspect(sz.w, sz.h);
    const [aw, ah] = aspect.split(':').map(Number);
    const hs = holders(null, [aw / ah, aw / ah], { kind: 'photo', label: p.slice(0, 40) });
    const { ok, status, j } = await post('/api/make', { prompt: p, aspect, count: 2, board: true, purpose });
    if (blocked(status, j, 'media')) { drop(hs); return; }
    if (!ok) { drop(hs); say({ role: 'mise', text: j.error || 'Couldn’t make that. Try again.', error: true }); return; }
    fill(hs, j.assets || []);
    say({ role: 'mise', text: `${(j.assets || []).length} photos with ${modelName(j.model) || 'Mise'} (${j.designs} designs). ${KEEP_NOTE}`, made: hs.map((h) => h.id) });
  }

  function send() {
    const t = text.trim(); if (!t) return;
    setText(''); setMention(null);
    if (selDesigns.length) {
      refineDesigns(selDesigns, t);
      if (selImages.length) runAction('edit', '', t);
    } else if (selImages.length && mode === 'video') {
      runAction('animate', 'Slow push-in', t);
    } else if (selImages.length && mode === 'design') {
      runWords(`${t}. Use ${selAssets.slice(0, 4).map(describe).join('; ')}.`, 'design', undefined, t);
    } else if (selImages.length) {
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
    // A file that's already on this board is selected rather than added again.
    const have = start.assets?.map((id) => cardsRef.current.find((c) => c.asset_id === id)).filter(Boolean) as BoardItem[] || [];
    const add = start.assets?.length ? addAssets(start.assets.filter((id) => !have.some((c) => c.asset_id === id))) : [];
    const on = [...have, ...add];
    if (start.designs?.length) {
      const ds = start.designs.map((id) => cardsRef.current.find((c) => c.asset_id === id)).filter(Boolean) as BoardItem[];
      const fresh = addDesigns(start.designs.filter((id) => !ds.some((c) => c.asset_id === id)));
      if (ds.length + fresh.length) { setSel([...ds, ...fresh].map((d) => d.id)); setTimeout(fit, 80); }
    }
    if (on.length) {
      setSel(on.map((a) => a.id));
      setTimeout(() => (on.length === 1 ? zoomTo(on[0]) : fit()), 80);
      if (start.tool === 'crop' && on.length === 1 && usable(byId.get(on[0].asset_id!))) setCropFor(on[0].id);
    }
    const p = (start.prompt || '').trim();
    // Words with a photo: a new scene for it (or a clip from it). Words alone: make it from scratch.
    if (p && add.length) runAction(start.mode === 'video' ? 'animate' : 'scene', start.mode === 'video' ? 'Slow push-in' : '', p, add.filter((c) => usable(byId.get(c.asset_id!))));
    else if (p) runWords(p, start.mode, start.size);
    onStarted?.();
  }, [loaded, start]); // eslint-disable-line react-hooks/exhaustive-deps
  // Saved designs from the library, back on the board to change.
  function addDesigns(ids: string[]) {
    const list = ids.map((id) => byId.get(id)).filter((a) => a?.provenance?.spec) as Asset[];
    if (!list.length) return [];
    return addAssets(list.map((a) => a.id));
  }

  // Clips: check every 8 seconds until they're saved.
  const waiting = cards.filter((c) => c.pending?.kind === 'video' && c.pending.job);
  useEffect(() => {
    if (!waiting.length) return;
    const t = setInterval(() => {
      for (const c of waiting) {
        fetch(`/api/make/video?workspace_id=${ws.id}&job=${encodeURIComponent(c.pending!.job!)}`).then((r) => r.json().then((j) => ({ ok: r.ok, j }))).then(({ ok, j }) => {
          if (!ok) setCards((all) => all.map((x) => (x.id === c.id ? { ...x, pending: undefined, error: j.error || 'The clip couldn’t be made.' } : x)), false);
          else if (j.ready) {
            setCards((all) => all.map((x) => (x.id === c.id ? { id: x.id, x: x.x, y: x.y, w: x.w, ratio: x.ratio, asset_id: j.asset.id, name: j.asset.name, url: j.asset.url } : x)), false);
            loadExtra([j.asset.id]); toast('Your clip is ready');
          }
        }).catch(() => {});
      }
    }, 8000);
    return () => clearInterval(t);
  }, [waiting.map((c) => c.id).join(','), ws.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- arranging ----------
  const groupOf = (c: BoardItem) => (c.group ? cardsRef.current.filter((x) => x.group === c.group).map((x) => x.id) : [c.id]);
  function duplicate() {
    if (!selCards.length) return;
    const copies = selCards.map((c) => ({ ...c, id: uid(), x: c.x + 40, y: c.y + 40, group: undefined, pending: undefined }));
    setCards((all) => [...all, ...copies]);
    setSel(copies.map((c) => c.id));
  }
  function group() {
    if (selCards.length < 2) return;
    const g = uid();
    setCards((all) => all.map((c) => (sel.includes(c.id) ? { ...c, group: g } : c)));
  }
  function ungroup() { setCards((all) => all.map((c) => (sel.includes(c.id) ? { ...c, group: undefined } : c))); }
  function order(front: boolean) {
    setCards((all) => { const a = all.filter((c) => sel.includes(c.id)), b = all.filter((c) => !sel.includes(c.id)); return front ? [...b, ...a] : [...a, ...b]; });
  }
  function align(how: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') {
    if (selCards.length < 2) return;
    const bx = selCards.map(itemBox);
    const L = Math.min(...bx.map((b) => b.x)), R = Math.max(...bx.map((b) => b.x + b.w)), T = Math.min(...bx.map((b) => b.y)), B = Math.max(...bx.map((b) => b.y + b.h));
    setCards((all) => all.map((c) => {
      if (!sel.includes(c.id)) return c;
      const b = itemBox(c);
      return how === 'left' ? { ...c, x: L } : how === 'right' ? { ...c, x: R - b.w } : how === 'center' ? { ...c, x: (L + R) / 2 - b.w / 2 }
        : how === 'top' ? { ...c, y: T } : how === 'bottom' ? { ...c, y: B - b.h } : { ...c, y: (T + B) / 2 - b.h / 2 };
    }));
  }
  function nudge(dx: number, dy: number) { setCards((all) => all.map((c) => (sel.includes(c.id) ? { ...c, x: c.x + dx, y: c.y + dy } : c))); }
  // Text: placed where you click with the text tool, in the brand's fonts and colours.
  function addText(at: { x: number; y: number }) {
    const t: BoardText = { value: 'Your words', size: 40, weight: 700, color: brand.colors.text || '#1d1d1f', font: 'head', align: 'left' };
    const it: BoardItem = { id: uid(), x: at.x, y: at.y - 25, w: 320, ratio: 320 / 56, text: t };
    setCards((all) => [...all, it]);
    setSel([it.id]); setEditing(it.id); setTool('select');
  }
  const setTextOf = (id: string, p: Partial<BoardText>) => setCards((all) => all.map((c) => (c.id === id && c.text ? { ...c, text: { ...c.text, ...p } } : c)));

  // ---------- canvas: pan, zoom, select, move, drop ----------
  const space = useRef(false);
  useEffect(() => {
    const el = cv.current; if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const r = el.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
        setView((v) => { const s = Math.min(4, Math.max(0.1, v.s * Math.exp(-e.deltaY * 0.01))); return { s, x: px - ((px - v.x) * s) / v.s, y: py - ((py - v.y) * s) / v.s }; });
      } else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [loaded]);
  const drag = useRef<{ kind: 'pan' | 'move' | 'marquee'; sx: number; sy: number; vx: number; vy: number; ids?: string[]; orig?: Map<string, { x: number; y: number }>; moved?: boolean; card?: string; add?: boolean; snapped?: boolean } | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  function downBg(e: React.PointerEvent) {
    if (e.button !== 0 && e.button !== 1) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setToolsOpen(false); setModelOpen(false);
    if (tool === 'text' && e.button === 0) { e.preventDefault(); addText(toWorld(e.clientX, e.clientY)); return; }
    const pan = tool === 'hand' || space.current || e.button === 1;
    drag.current = { kind: pan ? 'pan' : 'marquee', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, add: e.shiftKey || e.metaKey };
  }
  function downCard(e: React.PointerEvent, c: BoardItem) {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (editing === c.id) return; // clicks go to the words being edited
    if (editing) setEditing(null);
    if (tool === 'hand' || space.current) { (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }; return; }
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const mine = groupOf(c);
    const ids = e.shiftKey || e.metaKey ? (sel.includes(c.id) ? sel.filter((x) => !mine.includes(x)) : [...new Set([...sel, ...mine])]) : sel.includes(c.id) ? sel : mine;
    setSel(ids); setAsk(null); setToolsOpen(false);
    drag.current = { kind: 'move', card: c.id, add: e.shiftKey || e.metaKey, sx: e.clientX, sy: e.clientY, vx: 0, vy: 0, ids, orig: new Map(cardsRef.current.filter((x) => ids.includes(x.id)).map((x) => [x.id, { x: x.x, y: x.y }])) };
  }
  function move(e: React.PointerEvent) {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    if (d.kind === 'pan') setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }));
    else if (d.kind === 'marquee' && d.moved) {
      const a = toWorld(d.sx, d.sy), b = toWorld(e.clientX, e.clientY);
      setMarquee({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });
    } else if (d.kind === 'move' && d.moved) {
      if (!d.snapped) { snap(); d.snapped = true; }
      setCardsRaw((all) => all.map((c) => { const o = d.orig!.get(c.id); return o ? { ...c, x: o.x + dx / view.s, y: o.y + dy / view.s } : c; }));
    }
  }
  function up() {
    const d = drag.current; drag.current = null;
    if (d?.kind === 'marquee') {
      if (!d.moved) { setSel([]); setAsk(null); setEditing(null); }
      else if (marquee) {
        const hit = cardsRef.current.filter((c) => { const b = itemBox(c); return b.x < marquee.x + marquee.w && b.x + b.w > marquee.x && b.y < marquee.y + marquee.h && b.y + b.h > marquee.y; }).map((c) => c.id);
        setSel((s) => (d.add ? [...new Set([...s, ...hit])] : hit));
      }
      setMarquee(null);
    }
    // A click (no drag) on one of several selected: just that one (or its group).
    if (d?.kind === 'move' && !d.moved && !d.add && d.card && (d.ids?.length || 0) > 1) { const c = cardsRef.current.find((x) => x.id === d.card); if (c) setSel(groupOf(c)); }
  }
  // Dropping files: from the library panel (asset ids), or from the computer (uploaded to the library first).
  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    const at = toWorld(e.clientX, e.clientY);
    const ids = e.dataTransfer.getData('application/x-mise-assets');
    if (ids) { const add = addAssets(ids.split(','), null, at); if (add[0]) { autoName(add[0].name || 'Board'); setSel(add.map((a) => a.id)); } return; }
    const files = [...e.dataTransfer.files].filter((f) => /^image\/|^video\//.test(f.type));
    if (files.length) await upload(files, at);
  }
  const fileInput = useRef<HTMLInputElement>(null);
  async function upload(files: File[], at?: { x: number; y: number }) {
    if (!onUpload) return;
    toast(files.length === 1 ? 'Adding the file…' : `Adding ${files.length} files…`);
    const got = await onUpload(files);
    if (!got.length) return;
    setExtra((x) => { const n = { ...x }; for (const a of got) n[a.id] = a; return n; });
    setTimeout(() => { const add = addAssets(got.map((a) => a.id), null, at); setSel(add.map((a) => a.id)); if (add[0]) autoName(add[0].name || 'Board'); }, 0);
  }

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (e.key === 'Escape' && editing) { (document.activeElement as HTMLElement)?.blur?.(); setEditing(null); return; }
      if (typing || cropFor) return;
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === ' ') { space.current = true; return; }
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicate(); return; }
      if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); setSel(cardsRef.current.map((c) => c.id)); return; }
      if (mod && e.key.toLowerCase() === 'g') { e.preventDefault(); if (e.shiftKey) ungroup(); else group(); return; }
      if (mod) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) { e.preventDefault(); remove(sel); return; }
      if (e.key === 'Escape') { setSel([]); setAsk(null); setPanel(null); setToolsOpen(false); setKeys(false); return; }
      if (e.key === 'v' || e.key === 'V') setTool('select');
      else if (e.key === 'h' || e.key === 'H') setTool('hand');
      else if (e.key === 't' || e.key === 'T') setTool('text');
      else if (e.key === '!' || (e.shiftKey && e.key === '1')) fit();
      else if (e.key === '?') setKeys((o) => !o);
      else if (e.key === ']') order(true);
      else if (e.key === '[') order(false);
      else if (e.key === '+' || e.key === '=') zoom(1.25);
      else if (e.key === '-') zoom(1 / 1.25);
      else if (sel.length && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const n = e.shiftKey ? 10 : 1;
        nudge(e.key === 'ArrowLeft' ? -n : e.key === 'ArrowRight' ? n : 0, e.key === 'ArrowUp' ? -n : e.key === 'ArrowDown' ? n : 0);
      }
    };
    const ku = (e: KeyboardEvent) => { if (e.key === ' ') space.current = false; };
    window.addEventListener('keydown', k); window.addEventListener('keyup', ku);
    return () => { window.removeEventListener('keydown', k); window.removeEventListener('keyup', ku); };
  }, [sel, editing, cards, cropFor]); // eslint-disable-line react-hooks/exhaustive-deps
  const zoom = (f: number) => {
    const el = cv.current; if (!el) return;
    const px = el.clientWidth / 2, py = el.clientHeight / 2;
    setView((v) => { const s = Math.min(4, Math.max(0.1, v.s * f)); return { s, x: px - ((px - v.x) * s) / v.s, y: py - ((py - v.y) * s) / v.s }; });
  };
  function zoomTo(c: BoardItem) {
    const el = cv.current; if (!el) return;
    const h = itemHeight(c);
    const s = Math.min(4, Math.max(0.3, Math.min((el.clientWidth - 160) / c.w, (el.clientHeight - 220) / h)));
    setView({ s, x: (el.clientWidth - c.w * s) / 2 - c.x * s, y: (el.clientHeight - h * s) / 2 - c.y * s });
  }
  function editWords(c: BoardItem) { if (!c.design?.spec && !c.text) return; setSel([c.id]); setEditing(c.id); if (c.design) zoomTo(c); }

  async function deleteBoard() {
    if (!confirm(`Delete “${name}”? Files saved to your library stay there; anything not saved is deleted.`)) return;
    const scratch = cardsRef.current.filter((c) => !c.design && unsaved(assetOf(c))).map((c) => c.asset_id!);
    const { error } = await supabase.from('boards').delete().eq('id', boardId);
    if (error) { toast('Couldn’t delete the board.'); return; }
    if (scratch.length) await post('/api/board/files', { action: 'discard', asset_ids: scratch });
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

  // The model picker: Auto, or a named model. Paid ones show, but on Free they open the upgrade pop-up.
  const paid = plan !== 'free';
  const models: { id: Purpose | 'video' | 'studio'; name: string; good: string; designs: number; paid: boolean; for: Mode[] }[] = [
    { id: 'auto', name: 'Auto', good: 'Mise picks the best model for the job', designs: 0, paid: false, for: ['photo', 'video', 'design'] },
    { id: 'studio', name: 'Mise Studio (Claude)', good: 'Designs with live text in your brand', designs: 1, paid: false, for: ['design'] },
    { id: 'product', name: JOBS.product.model, good: JOBS.product.good, designs: JOBS.product.designs, paid: true, for: ['photo'] },
    { id: 'text', name: JOBS.text.model, good: JOBS.text.good, designs: JOBS.text.designs, paid: true, for: ['photo'] },
    { id: 'quick', name: JOBS.quick.model, good: JOBS.quick.good, designs: JOBS.quick.designs, paid: true, for: ['photo'] },
    { id: 'video', name: VIDEO_JOB.model, good: VIDEO_JOB.good, designs: VIDEO_JOB.designs, paid: true, for: ['video'] },
  ];
  const chatMode: Mode = selDesigns.length && !selImages.length ? 'design' : mode;
  const modelLabel = chatMode === 'design' ? 'Mise Studio' : chatMode === 'video' ? VIDEO_JOB.model : purpose === 'auto' ? 'Auto' : JOBS[purpose as Exclude<Purpose, 'auto'>]?.model || 'Auto';
  function pickModel(id: string) {
    const m = models.find((x) => x.id === id); if (!m) return;
    setModelOpen(false);
    if (m.paid && !paid) { openUpgrade({ reason: 'media' }); return; }
    if (id === 'product' || id === 'text' || id === 'quick' || id === 'auto') setPurpose(id as Purpose);
  }
  // @ in the chat: pick something on the board by name, and it's selected for the next message.
  const named = cards.filter((c) => !c.pending).map((c) => ({ c, label: c.text?.value || c.design?.spec?.name || assetOf(c)?.name || c.name || 'Item' }));
  const mentions = mention === null ? [] : named.filter((n) => n.label.toLowerCase().includes(mention.toLowerCase())).slice(0, 8);
  function onChatText(v: string) {
    setText(v);
    const m = /@([^@\n]{0,40})$/.exec(v);
    setMention(m ? m[1] : null);
  }
  function pickMention(c: BoardItem) {
    setText((t) => t.replace(/@([^@\n]{0,40})$/, ''));
    setMention(null);
    setSel((s) => [...new Set([...s, c.id])]);
    chatBox.current?.focus();
  }

  // Where the selection toolbar sits: above the selection, in screen space.
  const selBox = (() => {
    if (!selCards.length || editing) return null;
    const bx = selCards.map(itemBox);
    const x = Math.min(...bx.map((b) => b.x)), y = Math.min(...bx.map((b) => b.y)), r = Math.max(...bx.map((b) => b.x + b.w)), btm = Math.max(...bx.map((b) => b.y + b.h));
    return { left: view.x + ((x + r) / 2) * view.s, top: view.y + y * view.s, bottom: view.y + btm * view.s };
  })();
  const oneImage = selCards.length === 1 && selImages.length === 1 ? selImages[0] : null;
  const oneDesign = selCards.length === 1 && selDesigns.length === 1 ? selDesigns[0] : null;
  const oneText = selCards.length === 1 && selTexts.length === 1 ? selTexts[0] : null;
  const toSave = selCards.filter(needsSave);
  const TOOLS: { id: ToolId | 'crop' | ActionId; label: string; hint: string; ai: boolean }[] = [
    { id: 'crop', label: 'Crop and adjust', hint: 'Crop, sizes, rotate, flip, brightness, contrast', ai: false },
    { id: 'removebg', label: 'Remove background', hint: 'A clean cut-out, or a new plain background', ai: true },
    { id: 'erase', label: 'Erase', hint: 'Drag a box over something to remove it', ai: true },
    { id: 'extend', label: 'Extend background', hint: 'Make the picture wider or taller', ai: true },
    { id: 'upscale', label: 'Upscale', hint: 'Twice or four times the pixels', ai: true },
    { id: 'edittext', label: 'Edit text', hint: 'Change or translate the words in the picture', ai: true },
    { id: 'smartresize', label: 'Smart resize', hint: 'Up to 10 channel sizes, re-laid out, not cropped', ai: true },
    { id: 'light', label: 'Change the light or season', hint: 'Golden hour, studio, night, autumn…', ai: true },
    { id: 'scene', label: 'New scene', hint: 'The same product somewhere new', ai: true },
    { id: 'background', label: 'Clean background', hint: 'White, brand colour or studio', ai: true },
    { id: 'translate', label: 'Translate the words', hint: 'Same layout, another language', ai: true },
    { id: 'mockup', label: 'Mock it up', hint: 'Billboard, phone, shop window…', ai: true },
    { id: 'animate', label: 'Animate', hint: 'A short clip with sound', ai: true },
    { id: 'resize', label: 'Crop for social', hint: 'Six sizes cropped around the focal point, no AI', ai: false },
  ];
  const [toolQ, setToolQ] = useState('');
  // Keep the selection toolbar inside the canvas, however near the edge the selection is.
  const selBar = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = selBar.current, box = cv.current; if (!el || !box || !selBox) return;
    const w = el.offsetWidth, W = box.clientWidth;
    el.style.left = `${Math.min(W - w / 2 - 12, Math.max(w / 2 + 12, selBox.left))}px`;
  });
  function openTool(id: string, c: BoardItem) {
    setToolsOpen(false); setToolQ('');
    if (id === 'crop') { setCropFor(c.id); return; }
    if (['removebg', 'erase', 'extend', 'upscale', 'edittext', 'smartresize'].includes(id)) { setPanel({ tool: id as ToolId, card: c.id }); return; }
    const def = actionById(id); if (!def) return;
    if (def.kind === 'resize') { runAction('resize', '', '', [c]); return; }
    setMode('photo'); setAsk(def); setChatOpen(true);
  }

  const panelCard = panel ? cards.find((c) => c.id === panel.card) || null : null;
  const cropCard = cropFor ? cards.find((c) => c.id === cropFor) || null : null;
  const cropAsset = cropCard ? assetOf(cropCard) : null;

  return (
    <div className={'bd' + (bare ? ' bare' : '') + (libOpen && !bare ? ' lib' : '') + (chatOpen && !bare ? '' : ' nochat') + (full ? ' full' : '')}>
      {libOpen && !bare && <LibraryPanel library={library} urls={urls} onAdd={(ids) => { const add = addAssets(ids); if (add[0]) autoName(add[0].name || 'Board'); setSel(add.map((a) => a.id)); }} onClose={() => setLibOpen(false)} onUpload={onUpload ? () => fileInput.current?.click() : undefined} />}

      <div className={'bd-canvas tool-' + tool} ref={cv} onPointerDown={downBg} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }} onDrop={onDrop}>
        <div className="bd-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`, ['--z' as any]: view.s }}>
          {cards.map((c) => {
            const a = assetOf(c), src = srcOf(c), on = sel.includes(c.id);
            const video = a?.kind === 'video' || (c.pending?.kind === 'video');
            const d = c.design;
            if (c.text) return (
              <div key={c.id} className={`bd-card text${on ? ' on' : ''}${editing === c.id ? ' editing' : ''}`} style={{ left: c.x, top: c.y, width: c.w }}
                onPointerDown={(e) => downCard(e, c)} onDoubleClick={() => editWords(c)}>
                <TextCard t={c.text} editing={editing === c.id} brand={brand}
                  onText={(v) => { if (v && v !== c.text!.value) setTextOf(c.id, { value: v }); }}
                  onHeight={(h) => { const r = c.w / h; if (Math.abs((c.ratio || 0) - r) > 0.01) setCardsRaw((all) => all.map((x) => (x.id === c.id ? { ...x, ratio: r } : x))); }} />
              </div>
            );
            if (d) return (
              <div key={c.id} className={`bd-card design${on ? ' on' : ''}${editing === c.id ? ' editing' : ''}${d.status === 'loading' ? ' pending' : ''}${d.status === 'error' ? ' failed' : ''}`} style={{ left: c.x, top: c.y, width: c.w }}
                onPointerDown={(e) => downCard(e, c)} onDoubleClick={() => d.status === 'ready' && editWords(c)}>
                <div className="bd-img" style={{ aspectRatio: `${d.size.w} / ${d.size.h}` }}>
                  {d.spec ? (
                    <div className={'bd-design' + (d.status === 'refining' ? ' busy' : '')}>
                      <DesignCanvas spec={d.spec} size={d.size} brand={brand} srcOf={designSrc} editable={editing === c.id && d.status === 'ready'} onText={(i, t) => designText(c, i, t)} />
                    </div>
                  ) : d.status === 'error' ? (
                    <span className="bd-wait">{d.error}<button type="button" className="btn" onPointerDown={(e) => e.stopPropagation()} onClick={() => retryDesign(c)}>Try again</button></span>
                  ) : <span className="bd-wait"><span className="spin" aria-hidden />Designing…</span>}
                  {d.status === 'refining' && <span className="bd-wait over"><span className="spin" aria-hidden />Changing…</span>}
                </div>
                {d.spec && <div className="bd-cap"><span>{d.label ? `${d.label} · ` : ''}{d.spec.name}</span>{saving.includes(c.id) ? <em className="ns">Saving…</em> : !c.asset_id ? <em className="ns">Not saved</em> : d.dirty ? <em className="ns">Changes not saved</em> : null}</div>}
              </div>
            );
            // Products look the same as everywhere else in Mise: the email product card.
            if (c.product && a?.kind === 'product') return (
              <div key={c.id} className={`bd-card product${on ? ' on' : ''}`} style={{ left: c.x, top: c.y, width: c.w }}
                onPointerDown={(e) => downCard(e, c)} onDoubleClick={() => { setSel([c.id]); zoomTo(c); setChatOpen(true); setTimeout(() => pname.current?.focus(), 80); }}>
                <ProductCard a={withDraft(a)} src={src} onHeight={(h) => {
                  const r = c.w / h;
                  if (!c.measured || Math.abs((c.ratio || 0) - r) > 0.01) setCardsRaw((all) => all.map((x) => (x.id === c.id ? { ...x, ratio: r, measured: true } : x)));
                }} />
              </div>
            );
            return (
              <div key={c.id} className={`bd-card${on ? ' on' : ''}${c.pending ? ' pending' : ''}${c.error ? ' failed' : ''}${busy.includes(c.id) ? ' working' : ''}`} style={{ left: c.x, top: c.y, width: c.w }}
                onPointerDown={(e) => downCard(e, c)} onDoubleClick={() => { setSel([c.id]); zoomTo(c); }}>
                <div className="bd-img" style={{ aspectRatio: `${c.ratio || ratioOf(a)}` }}>
                  {c.pending ? <span className="bd-wait"><span className="spin" aria-hidden />{c.pending.kind === 'video' ? 'Making a clip…' : c.pending.label || 'Making…'}</span>
                    : c.error ? <span className="bd-wait">{c.error}</span>
                    : src ? (video ? <video src={src} muted loop playsInline autoPlay /> : <img src={src} alt={a?.fields?.alt || a?.name || ''} draggable={false} />)
                    : <span className="bd-wait">{a ? 'Loading…' : 'Not in the library any more'}</span>}
                </div>
                {!c.pending && <div className="bd-cap"><span>{a?.name || c.name || ''}</span>{saving.includes(c.id) ? <em className="ns">Saving…</em> : unsaved(a) ? <em className="ns">Not saved</em> : a?.status === 'draft' ? <em>Draft</em> : null}</div>}
              </div>
            );
          })}
          {marquee && <div className="bd-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
        </div>

        {panel?.tool === 'erase' && panelCard && <EraseBox c={panelCard} view={view} onCancel={() => setPanel(null)} onErase={(rect) => runTool('erase', panelCard, { rect }, 'Erase the marked area')} />}

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
                : mode === 'design' ? 'Three options in your brand kit.' : mode === 'photo' ? 'Two takes in your brand’s style.' : 'A clip with sound, up to 8 seconds.'} They stay on the board until you save them.</span>
              <button className="primary" type="button" onClick={go}>{!can ? 'Make it in Claude' : mode === 'design' ? 'Design 3 options' : mode === 'photo' ? 'Make 2 photos' : 'Make a clip'} <span aria-hidden>→</span></button>
            </div>
            <div className="bd-stage-or"><span>or</span></div>
            <button type="button" className="bd-stage-add" onClick={() => setAdding(true)}>
              <span className="bd-stage-plus" aria-hidden>+</span>
              <span><b>Start from your files</b><small>Bring in photos, logos or products to edit, resize, restyle or animate</small></span>
            </button>
          </div>
        )}

        {/* The selection toolbar: what you can do with what's selected, right above it. */}
        {selBox && !bare && !cropFor && (
          <div className="bd-seltools" ref={selBar} style={{ left: selBox.left, top: Math.max(56, selBox.top - 12) }} onPointerDown={(e) => e.stopPropagation()}>
            {oneImage && <>
              <div className="bd-tools-menu">
                <button type="button" className="hi" aria-expanded={toolsOpen} onClick={() => setToolsOpen((o) => !o)}><Icon.Wand size={16} />Tools</button>
                {toolsOpen && (
                  <div className="bd-menu" role="menu">
                    <input className="in" autoFocus placeholder="Search tools" value={toolQ} onChange={(e) => setToolQ(e.target.value)} />
                    {TOOLS.filter((t) => `${t.label} ${t.hint}`.toLowerCase().includes(toolQ.toLowerCase())).map((t) => (
                      <button key={t.id} type="button" role="menuitem" onClick={() => openTool(t.id, oneImage)}>
                        <b>{t.label}{t.ai && <i className="ai">AI</i>}</b><small>{t.hint}</small>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button type="button" onClick={() => setCropFor(oneImage.id)} title="Crop, rotate and adjust"><Icon.Crop size={16} />Crop</button>
              <button type="button" onClick={() => setPanel({ tool: 'removebg', card: oneImage.id })}>Remove background</button>
              <button type="button" onClick={() => setPanel({ tool: 'smartresize', card: oneImage.id })}>Smart resize</button>
            </>}
            {oneDesign && <>
              <button type="button" className="hi" onClick={() => editWords(oneDesign)}>Edit the words</button>
              <button type="button" onClick={() => everySize(oneDesign)}>Every size</button>
              {(oneDesign.design!.history || []).length > 0 && <button type="button" onClick={() => undoDesign(oneDesign)}>↶ Undo change</button>}
              <button type="button" onClick={() => downloadDesign(oneDesign)}>PNG</button>
            </>}
            {oneText && <>
              <button type="button" onClick={() => setTextOf(oneText.id, { size: Math.max(10, Math.round(oneText.text!.size / 1.15)) })} aria-label="Smaller">A−</button>
              <button type="button" onClick={() => setTextOf(oneText.id, { size: Math.min(400, Math.round(oneText.text!.size * 1.15)) })} aria-label="Bigger">A+</button>
              <button type="button" aria-pressed={oneText.text!.weight >= 700} onClick={() => setTextOf(oneText.id, { weight: oneText.text!.weight >= 700 ? 400 : 700 })}><b>B</b></button>
              <button type="button" onClick={() => setTextOf(oneText.id, { font: oneText.text!.font === 'head' ? 'body' : 'head' })}>{oneText.text!.font === 'head' ? 'Heading font' : 'Body font'}</button>
              <button type="button" onClick={() => setTextOf(oneText.id, { align: oneText.text!.align === 'left' ? 'center' : oneText.text!.align === 'center' ? 'right' : 'left' })}>Align {oneText.text!.align}</button>
              {[...new Set([brand.colors.text, brand.colors.primary, brand.colors.accent, '#ffffff'])].filter(Boolean).map((col) => (
                <button key={col} type="button" className="sw" style={{ background: col }} aria-label={`Colour ${col}`} aria-pressed={oneText.text!.color === col} onClick={() => setTextOf(oneText.id, { color: col })} />
              ))}
            </>}
            {selCards.length > 1 && <>
              <span className="bd-align">
                {(['left', 'center', 'right', 'top', 'middle', 'bottom'] as const).map((h) => <button key={h} type="button" title={`Align ${h}`} onClick={() => align(h)}>{({ left: '⇤', center: '↔', right: '⇥', top: '⤒', middle: '↕', bottom: '⤓' } as any)[h]}</button>)}
              </span>
              {selCards.every((c) => c.group && c.group === selCards[0].group) ? <button type="button" onClick={ungroup}>Ungroup</button> : <button type="button" onClick={group}>Group</button>}
            </>}
            {toSave.length > 0 && <button type="button" className="go" disabled={toSave.some((c) => saving.includes(c.id))} onClick={() => keep(toSave)}>{toSave.some((c) => saving.includes(c.id)) ? 'Saving…' : toSave.length > 1 ? `Save ${toSave.length}` : oneDesign?.asset_id ? 'Save changes' : 'Save to library'}</button>}
            <span className="bd-sep" />
            <button type="button" title="Bring to front ( ] )" onClick={() => order(true)}><Icon.Layers size={16} /></button>
            <button type="button" title="Duplicate (⌘D)" onClick={duplicate}><Icon.Copy size={16} /></button>
            <button type="button" title="Remove from the board (Delete)" onClick={() => remove(sel)}><Icon.Close size={15} /></button>
          </div>
        )}
        {panel && panelCard && panel.tool !== 'erase' && selBox && (
          <ToolPanel tool={panel.tool as ToolId} c={panelCard} a={assetOf(panelCard)} brand={brand} pos={{ left: selBox.left, top: selBox.top + 34 }} post={post}
            onClose={() => setPanel(null)} onRun={(t, opts, label) => runTool(t, panelCard, opts, label)} />
        )}
        {panel?.tool === 'erase' && <div className="bd-hint" onPointerDown={(e) => e.stopPropagation()}>Drag a box over what to remove, then click Erase. <button type="button" className="btn" onClick={() => setPanel(null)}>Cancel</button></div>}
        {editing && <div className="bd-editing" onPointerDown={(e) => e.stopPropagation()}>Click the words to change them<button type="button" className="btn" onClick={() => { (document.activeElement as HTMLElement)?.blur?.(); setEditing(null); }}>Done</button></div>}

        <div className="bd-top" onPointerDown={(e) => e.stopPropagation()}>
          <button className="btn quiet" type="button" onClick={onBack}>← Boards</button>
          <input className="bd-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} aria-label="Board name" />
        </div>
        <div className="bd-topright" onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" title="Undo (⌘Z)" disabled={!past.current.length} onClick={undo}><Icon.Undo size={16} /></button>
          <button type="button" title="Redo (⇧⌘Z)" disabled={!future.current.length} onClick={redo}><Icon.Redo size={16} /></button>
          <span className="bd-sep" />
          {!bare && <button type="button" title={chatOpen ? 'Hide the chat' : 'Show the chat'} aria-pressed={chatOpen} onClick={() => setChatOpen((o) => !o)}><Icon.Chat size={16} /></button>}
          <button type="button" title={full ? 'Leave full screen' : 'Full screen'} aria-pressed={full} onClick={() => setFull((f) => !f)}>{full ? <Icon.Shrink size={16} /> : <Icon.Expand size={16} />}</button>
        </div>
        {!bare && <div className="bd-tools" onPointerDown={(e) => e.stopPropagation()}>
          <span className="bd-modeset">
            <button type="button" title="Select (V)" aria-pressed={tool === 'select'} onClick={() => setTool('select')}><Icon.Cursor size={16} /></button>
            <button type="button" title="Hand: drag to move around (H)" aria-pressed={tool === 'hand'} onClick={() => setTool('hand')}><Icon.Hand size={16} /></button>
            <button type="button" title="Text (T)" aria-pressed={tool === 'text'} onClick={() => setTool('text')}><Icon.Text size={16} /></button>
          </span>
          <span className="bd-sep" />
          <button type="button" title={libOpen ? 'Hide the library' : 'Your library'} aria-pressed={libOpen} onClick={() => setLibOpen((o) => !o)}><Icon.Library size={16} /></button>
          {onUpload && <button type="button" title="Upload from your computer" onClick={() => fileInput.current?.click()}><Icon.Upload size={16} /></button>}
          <span className="bd-sep" />
          <span className="bd-zoom">
            <button type="button" aria-label="Zoom out" onClick={() => zoom(1 / 1.25)}>−</button>
            <span>{Math.round(view.s * 100)}%</span>
            <button type="button" aria-label="Zoom in" onClick={() => zoom(1.25)}>+</button>
            <button type="button" onClick={fit}>Fit</button>
          </span>
          <button type="button" title="Keyboard shortcuts (?)" onClick={() => setKeys((o) => !o)}><Icon.Keyboard size={16} /></button>
        </div>}
        {keys && (
          <div className="bd-keys" onPointerDown={(e) => e.stopPropagation()} role="dialog" aria-label="Keyboard shortcuts">
            <div className="bd-keys-h"><b>Keyboard shortcuts</b><button type="button" className="x" aria-label="Close" onClick={() => setKeys(false)}><Icon.Close /></button></div>
            <dl>{SHORTCUTS.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          </div>
        )}
        <input ref={fileInput} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ''; if (f.length) upload(f); }} />
      </div>

      {!bare && chatOpen && <aside className="bd-panel" aria-label="Make with AI">
        <div className="bd-thread" aria-live="polite">
          {!thread.length && (
            <div className="bd-hello">
              <b>What next?</b>
              <span>Select something and say what to change, or describe something new. Type @ to point at something on the board. What AI makes stays here until you save it.</span>
            </div>
          )}
          {thread.map((t) => (
            <div key={t.id} className={`bd-turn ${t.role}${t.error ? ' err' : ''}`}>
              {t.refs?.length ? <div className="bd-refs">{t.refs.slice(0, 4).map((id) => { const a = byId.get(id); const u = a && (U(a.images?.email?.path) || U(a.storage_path)); return u ? <img key={id} src={u} alt="" /> : null; })}</div> : null}
              <p>{t.text}</p>
              {t.made?.length ? <button type="button" className="linkish" onClick={() => setSel(t.made!.filter((id) => cards.some((c) => c.id === id)))}>Select {t.made.length === 1 ? 'it' : 'them'}</button> : null}
            </div>
          ))}
          <div ref={threadEnd} />
        </div>

        <div className="bd-compose">
          {selProduct && pdraft?.id === selProduct.id && onPatchAsset && (
            <div className="bd-pfields">
              <div className="bd-pfields-h"><b>Product card</b><span>{pdraft.saved ? 'Saved' : 'Saves as you go'}</span></div>
              {([['eyebrow', 'Label', 'e.g. New in'], ['name', 'Name', ''], ['description', 'Description', ''], ['price', 'Price', ''], ['cta', 'Button', 'No button'], ['link', 'Link', 'https://']] as [keyof ProductCopy, string, string][]).map(([k, label, ph]) => (
                <label key={k} className={k === 'description' ? 'wide' : k === 'name' || k === 'link' ? 'wide' : ''}>
                  <span>{label}</span>
                  {k === 'description'
                    ? <textarea className="in" rows={3} maxLength={300} value={pdraft.v[k]} placeholder={ph} onChange={(e) => setPdraft({ id: pdraft.id, v: { ...pdraft.v, [k]: e.target.value } })} onBlur={saveProduct} />
                    : <input ref={k === 'name' ? pname : undefined} className={'in' + (k === 'link' ? ' mono' : '')} value={pdraft.v[k]} placeholder={ph} maxLength={k === 'link' ? 500 : 120}
                        onChange={(e) => setPdraft({ id: pdraft.id, v: { ...pdraft.v, [k]: e.target.value } })} onBlur={saveProduct} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />}
                </label>
              ))}
              <p className="tip">Changes this product everywhere in Mise. A feed sync keeps your name, label, description and button.</p>
            </div>
          )}
          {selImages.length > 0 && !ask && mode === 'photo' && (
            <div className="bd-sugs">
              {SUGGESTED.filter((a) => a.batch || selImages.length === 1).map((a) => (
                <button key={a.id} type="button" title={`${a.blurb} · ${cost(a)}`} onClick={() => (a.kind === 'resize' ? runAction('resize') : setAsk(a))}>{a.id === 'resize' ? 'Crop for social' : a.title}</button>
              ))}
            </div>
          )}
          {ask && (
            <div className="bd-ask">
              <div className="bd-ask-h"><b>{ask.title}</b><span>{cost(ask)}</span><button type="button" className="linkish" onClick={() => setAsk(null)}>Back</button></div>
              <div className="bd-sugs">{(ask.choices || []).map((c) => <button key={c} type="button" onClick={() => { const a = ask; setAsk(null); runAction(a.id, c); }}>{c}</button>)}</div>
              {ask.ask && <span className="tip">Or type it below.</span>}
            </div>
          )}
          {!selAssets.length && !selCards.length && !thread.length && (
            <div className="bd-sugs">{TRIES[mode].map((t) => <button key={t} type="button" onClick={() => runWords(t, mode)}>{t}</button>)}</div>
          )}

          {!(selDesigns.length && !selImages.length) && (
            <div className="seg bd-modes" role="group" aria-label="What to make">
              {(['design', 'photo', 'video'] as Mode[]).map((m) => <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
                title={selImages.length ? (m === 'design' ? 'Designs that use the selected photos' : m === 'photo' ? 'Change the selected photos' : 'A clip from the selected photo') : undefined}>
                {selImages.length ? (m === 'design' ? 'Design with it' : m === 'photo' ? 'Change it' : 'Animate it') : MODE_LABEL[m]}</button>)}
            </div>
          )}
          <div className="bd-box2">
            {(selAssets.length || selDesigns.length) ? (
              <div className="bd-ctx">
                {selDesigns.slice(0, 4).map((c) => <span key={c.id} title={c.design!.spec!.name}><b>{c.design!.spec!.name}</b></span>)}
                {selAssets.filter((a) => !selDesigns.some((c) => c.asset_id === a.id)).slice(0, 4).map((a) => { const c = selected.find((x) => x.asset_id === a.id)!; const u = srcOf(c); return <span key={c.id} title={a.name}>{u && a.kind !== 'video' ? <img src={u} alt="" /> : null}<b>{a.name}</b><button type="button" aria-label={`Unselect ${a.name}`} onClick={() => setSel((s) => s.filter((x) => x !== c.id))}>×</button></span>; })}
                {selAssets.length + selDesigns.length > 8 && <em>+{selAssets.length + selDesigns.length - 8}</em>}
              </div>
            ) : null}
            {mention !== null && mentions.length > 0 && (
              <div className="bd-mention" role="listbox">
                {mentions.map(({ c, label }) => <button key={c.id} type="button" role="option" onMouseDown={(e) => { e.preventDefault(); pickMention(c); }}>{label}</button>)}
              </div>
            )}
            <textarea ref={chatBox} className="in" rows={2} value={text} onChange={(e) => onChatText(e.target.value)} maxLength={1500}
              placeholder={ask?.ask ? ask.ask.placeholder : selDesigns.length ? 'Say what to change: “darker”, “bigger headline”, “use the knitwear photo”'
                : selImages.length && mode === 'video' ? 'Describe the motion, e.g. “slow push-in, steam rising”'
                : selImages.length && mode === 'design' ? 'e.g. An autumn sale email hero' : selImages.length ? 'Say what to change, e.g. “make it autumn”' : 'Describe something new, or type @ to pick from the board'}
              onKeyDown={(e) => {
                if (mention !== null && mentions.length && (e.key === 'Enter' || e.key === 'Tab')) { e.preventDefault(); pickMention(mentions[0].c); return; }
                if (e.key === 'Escape' && mention !== null) { setMention(null); return; }
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (ask?.ask && text.trim()) { const a = ask; setAsk(null); const t = text; setText(''); runAction(a.id, '', t); } else send(); }
              }} />
            <div className="bd-box-row">
              <button type="button" className="ico" title="Point at something on the board" onClick={() => { onChatText(`${text}@`); chatBox.current?.focus(); }}>@</button>
              <span className="fill" />
              <div className="bd-model">
                <button type="button" aria-expanded={modelOpen} onClick={() => setModelOpen((o) => !o)}>{modelLabel}<Icon.Chevron /></button>
                {modelOpen && (
                  <div className="bd-menu up" role="menu">
                    {models.filter((m) => m.for.includes(chatMode)).map((m) => {
                      const locked = m.paid && !paid;
                      const on = m.id === 'studio' ? chatMode === 'design' : m.id === 'video' ? chatMode === 'video' : chatMode === 'photo' && purpose === m.id;
                      return (
                        <button key={m.id} type="button" role="menuitemradio" aria-checked={on} className={locked ? 'locked' : ''} onClick={() => pickModel(m.id)}>
                          <b>{m.name}{locked ? <i className="lock">Pro</i> : on ? <i className="tick">✓</i> : null}</b>
                          <small>{m.good}{m.designs ? ` · ${m.designs} design${m.designs === 1 ? '' : 's'} each` : ''}</small>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <button className="primary send" type="button" aria-label="Send" disabled={!text.trim()} onClick={() => { if (ask?.ask) { const a = ask; setAsk(null); const t = text; setText(''); runAction(a.id, '', t); } else send(); }}>↑</button>
            </div>
          </div>
          <div className="bd-foot">
            <span className="tip">{selDesigns.length ? `Changes ${selDesigns.length === 1 ? 'the selected design' : `${selDesigns.length} designs`}, 1 design each`
              : selImages.length && mode === 'video' ? 'A clip with sound from the selected photo'
              : selImages.length && mode === 'design' ? 'Three designs that use the selected photos'
              : selImages.length ? `Changes ${selImages.length === 1 ? 'the selected photo' : `${selImages.length} photos`}, 2 versions each` : mode === 'design' ? 'Three options in your brand kit' : mode === 'photo' ? 'Two takes, in your brand’s style' : 'An 8-second clip with sound'}</span>
            <button type="button" className="linkish" onClick={deleteBoard}>Delete board</button>
          </div>
        </div>
      </aside>}

      {cropCard && cropAsset && (U(cropAsset.storage_path)) && (
        <div className="bd-focus" role="dialog" aria-label={`Crop and adjust ${cropAsset.name}`}>
          <ImageEditor it={cropAsset} src={U(cropAsset.storage_path)!} kit={kit || null} toast={toast}
            onCancel={() => setCropFor(null)}
            onSave={(r, asCopy) => cropSaved(cropCard, r, !asCopy && libIds.has(cropAsset.id))} />
        </div>
      )}
      {adding && <AddFiles library={library} urls={urls} onClose={() => setAdding(false)} onAdd={(ids) => { const add = addAssets(ids); if (add[0]) autoName(add[0].name || 'Board'); setSel(add.map((a) => a.id)); setAdding(false); setTimeout(fit, 60); }} />}
    </div>
  );
}

// The library beside the canvas: search, filter, and drag files onto the board (or click + to add).
function LibraryPanel({ library, urls, onAdd, onClose, onUpload }: { library: Asset[]; urls: Record<string, string>; onAdd: (ids: string[]) => void; onClose: () => void; onUpload?: () => void }) {
  const [q, setQ] = useState('');
  const [tab, setTab] = useState('all');
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const list = library.filter((a) => ['image', 'logo', 'product', 'video'].includes(a.kind) && a.storage_path && (a.lifecycle || 'active') === 'active')
    .filter((a) => tab === 'all' || (tab === 'design' ? isDesignAsset(a) : a.kind === tab && !(tab === 'image' && isDesignAsset(a))))
    .filter((a) => words.every((w) => `${a.name} ${(a.tags || []).join(' ')} ${a.pid || ''} ${a.description || ''}`.toLowerCase().includes(w))).slice(0, 200);
  const u = (a: Asset) => (a.kind !== 'video' && a.images?.email?.path && urls[a.images.email.path]) || urls[a.storage_path];
  return (
    <aside className="bd-lib" aria-label="Your library" onPointerDown={(e) => e.stopPropagation()}>
      <div className="bd-lib-h"><b>Library</b>{onUpload && <button type="button" className="btn quiet" onClick={onUpload}><Icon.Upload size={15} />Upload</button>}<button type="button" className="x" aria-label="Hide the library" onClick={onClose}><Icon.Close /></button></div>
      <input className="in" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your library" />
      <div className="bd-lib-tabs" role="tablist">{LIB_TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}</div>
      <div className="bd-lib-grid">
        {list.map((a) => (
          <div key={a.id} className="bd-lib-item" draggable title={`${a.name}: drag onto the board`}
            onDragStart={(e) => { e.dataTransfer.setData('application/x-mise-assets', a.id); e.dataTransfer.effectAllowed = 'copy'; }}>
            {a.kind === 'video' ? <video src={u(a)} muted preload="metadata" /> : <img src={u(a)} alt="" loading="lazy" draggable={false} />}
            <span>{a.name}</span>
            <button type="button" aria-label={`Add ${a.name} to the board`} onClick={() => onAdd([a.id])}>+</button>
          </div>
        ))}
        {!list.length && <p className="tip">Nothing here.</p>}
      </div>
      <p className="tip bd-lib-foot">Drag files onto the board, or drop them from your computer.</p>
    </aside>
  );
}

// Words on the board, in the brand's fonts. Measured so the board can lay them out.
function TextCard({ t, editing, brand, onText, onHeight }: { t: BoardText; editing: boolean; brand: StudioBrand; onText: (v: string) => void; onHeight: (h: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const report = useRef(onHeight); report.current = onHeight;
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => { const h = el.offsetHeight; if (h > 4) report.current(h); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!editing || !el) return;
    // After the click that made it has finished, so the browser doesn't move focus away again.
    const t = setTimeout(() => { el.focus(); const r = document.createRange(); r.selectNodeContents(el); const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r); }, 30);
    return () => clearTimeout(t);
  }, [editing]);
  return (
    <div ref={ref} className="bd-img bd-text" contentEditable={editing || undefined} suppressContentEditableWarning spellCheck={editing}
      onBlur={(e) => onText((e.currentTarget.innerText || '').trim())}
      style={{ fontFamily: t.font === 'head' ? brand.head : brand.body, fontSize: t.size, fontWeight: t.weight, color: t.color, textAlign: t.align, textTransform: t.font === 'head' && brand.upper ? 'uppercase' : 'none' }}>
      {t.value}
    </div>
  );
}

// Erase: drag a box over the picture, then Erase. The box is in the picture's own 0..1 space.
function EraseBox({ c, view, onCancel, onErase }: { c: BoardItem; view: { x: number; y: number; s: number }; onCancel: () => void; onErase: (r: { x: number; y: number; w: number; h: number }) => void }) {
  const h = c.w / (c.ratio || 1);
  const box = { left: view.x + c.x * view.s, top: view.y + c.y * view.s, width: c.w * view.s, height: h * view.s };
  const [r, setR] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const at = (e: React.PointerEvent) => { const b = (e.currentTarget as HTMLElement).getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - b.left) / b.width)), y: Math.min(1, Math.max(0, (e.clientY - b.top) / b.height)) }; };
  return (
    <div className="bd-erase" style={box} onPointerDown={(e) => { e.stopPropagation(); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); start.current = at(e); setR(null); }}
      onPointerMove={(e) => { if (!start.current) return; const p = at(e), s = start.current; setR({ x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) }); }}
      onPointerUp={() => { start.current = null; }}>
      {r && <div className="bd-erase-r" style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }} />}
      {r && r.w > 0.01 && r.h > 0.01 && (
        <div className="bd-erase-go" onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" className="primary" onClick={() => onErase(r)}>Erase</button>
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        </div>
      )}
    </div>
  );
}

// A tool's options, under the selection toolbar.
function ToolPanel({ tool, c, a, brand, pos, post, onClose, onRun }: {
  tool: ToolId; c: BoardItem; a: Asset | null; brand: StudioBrand; pos: { left: number; top: number };
  post: (url: string, body: any) => Promise<{ ok: boolean; status: number; j: any }>;
  onClose: () => void; onRun: (t: ToolId, opts: Record<string, unknown>, label: string) => void;
}) {
  const [sizes, setSizes] = useState<string[]>(SMART_DEFAULT);
  const [lines, setLines] = useState<{ from: string; to: string }[] | null>(null);
  const [reading, setReading] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (tool !== 'edittext' || !a) return;
    setReading(true);
    post('/api/board/tool', { tool: 'readtext', asset_id: a.id }).then(({ ok, j }) => {
      setReading(false);
      if (!ok) { setErr(j.error); return; }
      setLines((j.lines || []).map((l: string) => ({ from: l, to: l })));
    });
  }, [tool, a?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = (n: number) => `${n} design${n === 1 ? '' : 's'}`;
  return (
    <div className="bd-toolpanel" style={pos} onPointerDown={(e) => e.stopPropagation()}>
      <div className="bd-toolpanel-h"><b>{({ removebg: 'Remove background', upscale: 'Upscale', extend: 'Extend background', smartresize: 'Smart resize', edittext: 'Edit text' } as any)[tool]}</b><button type="button" className="x" aria-label="Close" onClick={onClose}><Icon.Close /></button></div>
      {tool === 'removebg' && <>
        <p className="tip">A clean cut-out of the subject. {d(TOOL_DESIGNS.removebg)}.</p>
        <div className="bd-sugs">
          <button type="button" onClick={() => onRun('removebg', {}, 'Remove the background')}>Transparent</button>
          <button type="button" onClick={() => onRun('removebg', { colour: '#ffffff' }, 'Put it on white')}><i className="sw" style={{ background: '#fff' }} />White</button>
          {brand.colors.primary && <button type="button" onClick={() => onRun('removebg', { colour: brand.colors.primary }, 'Put it on the brand colour')}><i className="sw" style={{ background: brand.colors.primary }} />Brand colour</button>}
          {brand.colors.surface && <button type="button" onClick={() => onRun('removebg', { colour: brand.colors.surface }, 'Put it on the surface colour')}><i className="sw" style={{ background: brand.colors.surface }} />Soft</button>}
        </div>
      </>}
      {tool === 'upscale' && <>
        <p className="tip">More pixels, sharper detail{a?.width ? `: now ${a.width}×${a.height}` : ''}. {d(TOOL_DESIGNS.upscale)}.</p>
        <div className="bd-sugs"><button type="button" onClick={() => onRun('upscale', { scale: 2 }, 'Upscale 2×')}>2×</button><button type="button" onClick={() => onRun('upscale', { scale: 4 }, 'Upscale 4×')}>4×</button></div>
      </>}
      {tool === 'extend' && <>
        <p className="tip">The picture stays as it is; the background carries on around it. {d(TOOL_DESIGNS.extend)}.</p>
        <div className="bd-sugs">{EXTEND_SHAPES.map((s) => <button key={s.id} type="button" onClick={() => onRun('extend', { shape: s.id }, `Extend to ${s.label.toLowerCase()}`)}>{s.label}</button>)}</div>
      </>}
      {tool === 'smartresize' && <>
        <p className="tip">Each size is re-laid out by AI, so nothing important is cut off. 1 design per size.</p>
        <div className="bd-checks">
          {SMART_SIZES.map((s) => (
            <label key={s.id}><input type="checkbox" checked={sizes.includes(s.id)} onChange={(e) => setSizes((v) => (e.target.checked ? [...v, s.id] : v.filter((x) => x !== s.id)))} />{s.label}<small>{s.w}×{s.h}</small></label>
          ))}
        </div>
        <button type="button" className="primary" disabled={!sizes.length} onClick={() => onRun('smartresize', { sizes }, `Smart resize: ${sizes.length} size${sizes.length === 1 ? '' : 's'}`)}>Make {sizes.length} size{sizes.length === 1 ? '' : 's'} · {d(sizes.length)}</button>
      </>}
      {tool === 'edittext' && <>
        {reading ? <p className="tip"><span className="spin" aria-hidden /> Reading the words…</p>
          : err ? <p className="tip err">{err}</p>
          : lines && !lines.length ? <p className="tip">No words found in this picture.</p>
          : lines && <>
            <p className="tip">Change any line. Clear one to remove it. {d(TOOL_DESIGNS.edittext)}.</p>
            <div className="bd-lines">{lines.map((l, i) => <input key={i} className="in" value={l.to} aria-label={`Text: ${l.from}`} onChange={(e) => setLines((v) => v!.map((x, j) => (j === i ? { ...x, to: e.target.value } : x)))} />)}</div>
            <button type="button" className="primary" disabled={!lines.some((l) => l.to !== l.from)} onClick={() => onRun('edittext', { edits: lines.filter((l) => l.to !== l.from) }, 'Change the words')}>Change the words</button>
          </>}
      </>}
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

// A product as its email product card (the same one as on its page), measured so the board can lay it out.
function ProductCard({ a, src, onHeight }: { a: Asset; src: string | null; onHeight: (h: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const report = useRef(onHeight); report.current = onHeight;
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => { const h = el.offsetHeight; if (h > 20) report.current(h); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="bd-img bd-pcard">
      <FitPreview width={300} fitHeight={false}>
        <Preview b={productAsBlock(a)} bt={BLOCK_TYPES.product.fields} slotSrc={() => src || undefined} />
      </FitPreview>
    </div>
  );
}
