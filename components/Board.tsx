'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SOCIAL_SIZES, SUGGESTED, actionById, actionDesigns, type ActionDef, type ActionId } from '@/lib/actions';
import { PRODUCT_INFO_H, bounds, itemHeight, place, uid, type BoardItem, type DesignState, type Turn } from '@/lib/boards';
import { productAsBlock, productCopy, productPatch, type ProductCopy } from '@/lib/products';
import { BLOCK_TYPES } from '@/lib/blockTypes';
import { FitPreview, Preview } from './BlockEditor';
import { modelName, nearestAspect } from '@/lib/models';
import { FORMATS as DESIGN_FORMATS, assetsUsed, formatFor, type Spec } from '@/lib/design';
import { exportPng } from '@/lib/exportDesign';
import { emailRendition } from '@/lib/renditions';
import { loadImg } from '@/lib/images';
import { runKey } from '@/lib/plans';
import { openInClaude } from '@/lib/openClaude';
import DesignCanvas, { type StudioBrand } from './DesignCanvas';
import { openUpgrade } from './Billing';
import { Icon } from './icons';
import type { Asset, Ws } from './Library';

// A Create board: a canvas of files and everything made from them, with AI beside it.
// Select something and ask for a change, or start from words. Everything AI makes is saved to the
// library as a draft (Review) and placed on the board next to what it came from.
export type Mode = 'design' | 'photo' | 'video';
// How a board starts: with files (and optionally what to do with them), or with words.
// draft: put the words in the prompt for the person to send, rather than running them.
// designs: saved designs (asset ids) to put on the board as editable designs.
export type Start = { mode: Mode; prompt?: string; size?: { w: number; h: number }; assets?: string[]; designs?: string[]; draft?: boolean };
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

export default function Board({ boardId, ws, userId, supabase, items: library, urls, plan, caps, brand, fonts, designSrc, start, onStarted, onBack, onOpen, gate, onClaude, onLibrary, onPatchAsset, toast }: {
  boardId: string; ws: Ws; userId: string; supabase: SupabaseClient; items: Asset[]; urls: Record<string, string>; plan: string;
  caps: Caps; onClaude: (prompt: string) => void;
  brand: StudioBrand; fonts: string[]; designSrc: (assetId: string) => string | undefined; // how designs are drawn
  start?: Start | null; onStarted?: () => void;
  onBack: () => void; onOpen: (id: string) => void;
  gate: (brief: string) => boolean; // false: the free run is used (the upgrade pop-up is open)
  onLibrary: () => void; // something was saved to the library
  onPatchAsset?: (id: string, patch: Record<string, any>) => Promise<boolean>; // a product's copy, edited right here
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
  const [editing, setEditing] = useState<string | null>(null); // the design whose words are being edited in place
  const [pdraft, setPdraft] = useState<{ id: string; v: ProductCopy; saved?: boolean } | null>(null); // the selected product's copy, as it's typed
  const pname = useRef<HTMLInputElement>(null);
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
      // A design that was still being made when the board was left: it won't arrive now.
      const kinds = new Map(library.map((x) => [x.id, x.kind]));
      const items = (data.items || []).map((c: BoardItem) => (!c.design ? (c.asset_id && !c.product && kinds.get(c.asset_id) === 'product' ? { ...c, product: true } : c)
        : c.design.status === 'refining' ? { ...c, design: { ...c.design, status: 'ready' as const } }
        : c.design.status === 'loading' ? { ...c, design: { ...c.design, status: 'error' as const, error: 'This one didn’t finish. Try again.' } } : c));
      setName(data.name); setCards(items); setThread(data.thread || []); setLoaded(true);
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
  const selImages = selected.filter((c) => usable(assetOf(c)) && !c.design);
  const selDesigns = cards.filter((c) => sel.includes(c.id) && c.design?.spec && c.design.status === 'ready');
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
    const spots = place(cardsRef.current, list.map(ratioOf), from, list.map((a) => (a.kind === 'product' ? PRODUCT_INFO_H : 0)));
    const add: BoardItem[] = list.map((a, i) => ({ id: uid(), asset_id: a.id, name: a.name, ...spots[i], ...(a.kind === 'product' ? { product: true } : {}) }));
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

  // How a file is named to the AI: products bring their name, price and copy, so designs can use them.
  const describe = (a: Asset) => a.kind === 'product'
    ? `the product “${a.name}”${a.price ? `, price ${a.price}` : ''}${a.fields?.eyebrow ? `, label “${a.fields.eyebrow}”` : ''}${a.fields?.description ? `, description “${String(a.fields.description).slice(0, 200)}”` : ''}${a.fields?.cta ? `, button “${a.fields.cta}”` : ''} (its photo)`
    : `the photo “${a.name}”`;

  // ---------- designs ----------
  const setDesign = (id: string, p: Partial<DesignState> | ((d: DesignState) => Partial<DesignState>)) =>
    setCards((all) => all.map((c) => (c.id === id && c.design ? { ...c, design: { ...c.design, ...(typeof p === 'function' ? p(c.design) : p) } } : c)));
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
      text: n ? `${n} design${n === 1 ? '' : 's'} in your brand. Select one to change it, double-click to edit the words, and save the one you want to your library.`
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
    if (prev) setDesign(c.id, { spec: prev, history: h.slice(0, -1), dirty: true });
  }
  function designText(c: BoardItem, i: number, text: string) {
    const d = c.design; if (!d?.spec || !text) return;
    const layers = d.spec.layers.map((l, j) => (j === i && (l.type === 'text' || l.type === 'button') ? { ...l, text } : l));
    if (JSON.stringify(layers) !== JSON.stringify(d.spec.layers)) setDesign(c.id, { spec: { ...d.spec, layers }, history: [...(d.history || []), d.spec].slice(-20), dirty: true });
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
      setCards((all) => all.map((x) => (x.id === c.id ? { ...x, asset_id: id!, name: d.spec!.name, design: { ...x.design!, dirty: false } } : x)));
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
  // Double-click a design: zoom in on it and edit its words where they are.
  function zoomTo(c: BoardItem) {
    const el = cv.current; if (!el) return;
    const h = itemHeight(c);
    const s = Math.min(4, Math.max(0.3, Math.min((el.clientWidth - 160) / c.w, (el.clientHeight - 200) / h)));
    setView({ s, x: (el.clientWidth - c.w * s) / 2 - c.x * s, y: (el.clientHeight - h * s) / 2 - c.y * s });
  }
  function editWords(c: BoardItem) {
    const el = cv.current; if (!el || !c.design?.spec) return;
    setSel([c.id]); setEditing(c.id);
    const h = itemHeight(c);
    const s = Math.min(4, Math.max(0.3, Math.min((el.clientWidth - 160) / c.w, (el.clientHeight - 200) / h)));
    setView({ s, x: (el.clientWidth - c.w * s) / 2 - c.x * s, y: (el.clientHeight - h * s) / 2 - c.y * s });
  }
  // Saved designs from the library, back on the board to change.
  function addDesigns(ids: string[]) {
    const list = ids.map((id) => byId.get(id)).filter((a) => a?.provenance?.spec) as Asset[];
    if (!list.length) return [];
    const sizes = list.map((a) => a.provenance.size || { w: a.width || 1200, h: a.height || 600 });
    const spots = place(cardsRef.current, sizes.map((z) => z.w / z.h));
    const add: BoardItem[] = list.map((a, i) => ({ id: uid(), asset_id: a.id, name: a.name, ...spots[i],
      design: { spec: a.provenance.spec, size: sizes[i], brief: a.provenance.prompt || a.name, run: runKey(a.provenance.prompt || a.name), status: 'ready' } }));
    cardsRef.current = [...cardsRef.current, ...add];
    setCards((all) => [...all, ...add]);
    return add;
  }

  // shown: what the person typed, when the prompt sent to the AI has more in it (product details).
  async function runWords(prompt: string, m: Mode, size?: { w: number; h: number }, shown?: string) {
    const p = prompt.trim(); if (!p) return;
    if (!(m === 'design' ? caps.design : m === 'photo' ? caps.image : caps.video)) { onClaude(p); return; } // not switched on here: Claude makes it
    say({ role: 'you', text: shown || p, refs: shown ? selAssets.map((a) => a.id) : undefined });
    autoName(shown || p);
    if (m === 'design') { await runDesign(p, size || formatFor(p)); return; }
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
    const add = start.assets?.length ? addAssets(start.assets) : [];
    if (start.designs?.length) {
      const ds = addDesigns(start.designs);
      if (ds.length) { setSel(ds.map((d) => d.id)); setTimeout(fit, 80); }
    }
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
    if (editing === c.id) return; // clicks go to the words being edited
    if (editing) setEditing(null);
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
    if (d?.kind === 'pan' && !d.moved) { setSel([]); setAsk(null); setEditing(null); }
    // A click (no drag) on one of several selected: just that one.
    if (d?.kind === 'move' && !d.moved && !d.add && d.card && (d.ids?.length || 0) > 1) setSel([d.card]);
  }
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === 'Escape' && editing) { (document.activeElement as HTMLElement)?.blur?.(); setEditing(null); return; }
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) {
        const lost = cards.filter((c) => sel.includes(c.id) && c.design?.spec && (!c.asset_id || c.design.dirty)).length;
        if (lost && !confirm(`${lost === 1 ? 'This design isn’t' : `${lost} designs aren’t`} saved to your library${lost === 1 ? ' (or has changes that aren’t)' : ''}. Remove from the board anyway?`)) return;
        setCards((all) => all.filter((c) => !sel.includes(c.id))); setSel([]); setEditing(null);
      }
      if (e.key === 'Escape') { setSel([]); setAsk(null); }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [sel, editing, cards]);
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
        <div className="bd-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`, ['--z' as any]: view.s }}>
          {cards.map((c) => {
            const a = assetOf(c), src = srcOf(c), on = sel.includes(c.id);
            const video = a?.kind === 'video' || (c.pending?.kind === 'video');
            const d = c.design;
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
                onPointerDown={(e) => downCard(e, c)} onDoubleClick={() => { setSel([c.id]); zoomTo(c); setTimeout(() => pname.current?.focus(), 80); }}>
                <ProductCard a={withDraft(a)} src={src} onHeight={(h) => {
                  const r = c.w / h;
                  if (!c.measured || Math.abs((c.ratio || 0) - r) > 0.01) setCards((all) => all.map((x) => (x.id === c.id ? { ...x, ratio: r, measured: true } : x)));
                }} />
              </div>
            );
            return (
              <div key={c.id} className={`bd-card${on ? ' on' : ''}${c.pending ? ' pending' : ''}${c.error ? ' failed' : ''}`} style={{ left: c.x, top: c.y, width: c.w }}
                onPointerDown={(e) => downCard(e, c)} onDoubleClick={() => { setSel([c.id]); zoomTo(c); }}>
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
        {editing && <div className="bd-editing" onPointerDown={(e) => e.stopPropagation()}>Click any words on the design to change them<button type="button" className="btn" onClick={() => { (document.activeElement as HTMLElement)?.blur?.(); setEditing(null); setTimeout(fit, 30); }}>Done</button></div>}
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
          {selAssets.length || selDesigns.length ? (
            <div className="bd-ctx">
              {selDesigns.slice(0, 5).map((c) => <span key={c.id} title={c.design!.spec!.name}><b>{c.design!.spec!.name}</b></span>)}
              {selAssets.filter((a) => !selDesigns.some((c) => c.asset_id === a.id)).slice(0, 5).map((a) => { const c = selected.find((x) => x.asset_id === a.id)!; const u = srcOf(c); return <span key={c.id} title={a.name}>{u && a.kind !== 'video' ? <img src={u} alt="" /> : null}<b>{a.name}</b></span>; })}
              {selAssets.length + selDesigns.length > 5 && <em>+{selAssets.length + selDesigns.length - 5}</em>}
              <button type="button" className="linkish" onClick={() => { setSel([]); setAsk(null); }}>Clear</button>
            </div>
          ) : null}
          {!(selDesigns.length && !selImages.length) && (
            <div className="seg bd-modes" role="group" aria-label="What to make">
              {(['design', 'photo', 'video'] as Mode[]).map((m) => <button key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
                title={selImages.length ? (m === 'design' ? 'Designs that use the selected photos' : m === 'photo' ? 'Change the selected photos' : 'A clip from the selected photo') : undefined}>
                {selImages.length ? (m === 'design' ? 'Design with it' : m === 'photo' ? 'Change it' : 'Animate it') : MODE_LABEL[m]}</button>)}
            </div>
          )}

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
          {selDesigns.length > 0 && (() => {
            const one = selDesigns.length === 1 ? selDesigns[0] : null;
            const unsaved = selDesigns.filter((c) => !c.asset_id || c.design!.dirty);
            return (
              <div className="bd-sugs">
                {unsaved.length > 0 && <button type="button" className="go" disabled={unsaved.some((c) => saving.includes(c.id))} onClick={() => unsaved.forEach((c) => saveDesign(c))}>
                  {unsaved.some((c) => saving.includes(c.id)) ? 'Saving…' : unsaved.every((c) => c.asset_id) ? 'Save changes' : unsaved.length > 1 ? `Save ${unsaved.length} to library` : 'Save to library'}</button>}
                {one && <button type="button" onClick={() => editWords(one)}>Edit the words</button>}
                {one && <button type="button" onClick={() => everySize(one)} title="Adapt it to every other size">Every size</button>}
                {one && (one.design!.history || []).length > 0 && <button type="button" onClick={() => undoDesign(one)}>↶ Undo</button>}
                {one && <button type="button" onClick={() => downloadDesign(one)}>Download PNG</button>}
                {one && <button type="button" onClick={() => designToFigma(one)} title="Save it, then Claude rebuilds it in Figma with live layers">Edit in Figma</button>}
              </div>
            );
          })()}
          {selImages.length > 0 && !ask && mode === 'photo' && (
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
              placeholder={ask?.ask ? ask.ask.placeholder : selDesigns.length ? 'Say what to change: “darker”, “bigger headline”, “use the knitwear photo”'
                : selImages.length && mode === 'video' ? 'Describe the motion, e.g. “slow push-in, steam rising, soft café sounds”'
                : selImages.length && mode === 'design' ? 'e.g. An autumn sale email hero' : selImages.length ? 'Say what to change, e.g. “make it autumn”' : mode === 'design' ? 'e.g. A LinkedIn banner for our autumn launch' : mode === 'photo' ? 'e.g. Our trainers on a wet street at dusk' : 'e.g. Slow push-in on the product, morning light'}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (ask?.ask && text.trim()) { const a = ask; setAsk(null); const t = text; setText(''); runAction(a.id, '', t); } else send(); } }} />
            <button className="primary" type="button" aria-label="Send" disabled={!text.trim()} onClick={() => { if (ask?.ask) { const a = ask; setAsk(null); const t = text; setText(''); runAction(a.id, '', t); } else send(); }}>↑</button>
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
