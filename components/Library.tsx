'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { BLOCK_TYPES, KIND_LABEL, autoBlockType, exportSize } from '@/lib/blockTypes';
import { baseName, drawFit, extOf, loadImg, parseCSV, toBlob } from '@/lib/images';
import { emailRendition } from '@/lib/renditions';
import { suggestAlt } from '@/lib/alt';
import { cleanText, productAsBlock, shortDescription } from '@/lib/products';
import AssetEditor from './AssetEditor';
import BlockEditor, { FitPreview, Preview, previewWidth } from './BlockEditor';
import { Icon, Wire, ART } from './icons';
import Feedback from './Feedback';
import GettingStarted from './GettingStarted';
import { Modal, HelpFigma, HelpFeed, Members, Connector, BlockTypePicker, WorkspaceSettings } from './Modals';
import BrandKitView from './BrandKit';
import Create from './Create';
import ImportSources from './ImportSources';
import { TABS, tabOf, tabLabel } from '@/lib/formats';
import { normaliseKit, type BrandKitRow } from '@/lib/brandKit';
import { studioKit } from '@/lib/studioBrand';
import { dhash, findDuplicate } from '@/lib/phash';
import { collectionQuery, describeRules, haystack, matchesQuery, matchesRules, suggestCollections, type Collection, type Rules } from '@/lib/collections';
import AutoOrganise from './AutoOrganise';
import { chipsOf, removeChip, searchKey, type SearchFilters } from '@/lib/searchChips';
import CollectionForm from './CollectionForm';
import Sharing from './Sharing';
import ShareDialog, { type ShareTarget } from './ShareDialog';
import Review from './Review';
import { reviewQueue } from '@/lib/review';
import { PlanSettings, UpgradeModal, openUpgrade, type UpgradeAsk } from './Billing';
import LibrarySync from './LibrarySync';
import { fromRows } from '@/lib/feedParse';
import ProductFeeds from './ProductFeeds';
import { countsAsFile, effectivePlan, FREE_FILES, freeLimitOf, mb, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, tooBig, type Plan } from '@/lib/plans';
import { expiresSoon, isAvailable, lifecycleOf, LIFECYCLE } from '@/lib/lifecycle';

export type Asset = Record<string, any> & { id: string; workspace_id: string; kind: string; name: string };
export type Ws = { id: string; name: string; role: string; figma_file_url?: string | null; figma_file_key?: string | null; figma_file_name?: string | null };
const WS_COLORS = ['#2f5bff', '#26313e', '#32a5db', '#e8a317', '#7b61ff', '#2f9e6e'];
const KINDS = ['image', 'logo', 'video', 'product', 'block'];
// Where assets come from. Products always come from the feed and blocks are made by the team,
// so the filter shows on the views where it means something.
const ORIGINS: [string, string][] = [['any', 'All'], ['uploaded', 'Uploaded'], ['product_feed', 'From feed'], ['generated', 'Generated'], ['draft', 'To review'], ['dupes', 'Possible duplicates'], ['unavailable', 'No longer available']];
const originOf = (a: Asset) => a.origin || (a.kind === 'product' ? 'product_feed' : 'uploaded');

export default function Library({ userId, email, appUrl }: { userId: string; email: string; appUrl: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [workspaces, setWorkspaces] = useState<Ws[]>([]);
  const [ws, setWs] = useState<string>('');
  const [items, setItems] = useState<Asset[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);
  // Three places: Create (home), Library (everything the brand has) and Brand kit; plus Settings.
  // Assets come first (the home), then Create; Brand kit and Settings support both.
  const [page, setPage] = useState<'review' | 'create' | 'library' | 'brand' | 'sharing' | 'settings'>('library');
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([]);
  const [folder, setFolder] = useState<string>('all'); // 'all' or a folder id
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collection, setCollection] = useState<string | null>(null); // a smart collection instead of a folder
  const [collForm, setCollForm] = useState<Partial<Collection> | null>(null);
  const [shareTarget, setShareTarget] = useState<ShareTarget | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const toggleSel = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [dropFolder, setDropFolder] = useState<string | null>(null);
  const [boxReturn, setBoxReturn] = useState(false);
  // Coming back from Stripe: ?billing=upgraded|new-brand|portal|cancelled[&ws=…]
  useEffect(() => {
    const u = new URL(location.href);
    const b = u.searchParams.get('billing');
    if (!b) return;
    const target = u.searchParams.get('ws');
    u.searchParams.delete('billing'); u.searchParams.delete('ws');
    history.replaceState({}, '', u);
    if (target) { setWs(target); try { localStorage.setItem('emailsy.ws', target); } catch {} }
    // Came from the pricing page with a website: carry on to the brand kit once checkout is done (or skipped).
    let after: { site?: string; connect?: string; at?: number } | null = null;
    try { after = JSON.parse(localStorage.getItem('mise.afterPay') || 'null'); localStorage.removeItem('mise.afterPay'); } catch {}
    if (after && !(after.site && Date.now() - (after.at || 0) < 864e5)) after = null;
    if (b === 'upgraded') setTimeout(() => {
      toast('Welcome to Pro. It can take a few seconds to show.');
      if (after) setSignup({ site: after.site, connect: after.connect }); else { setSettingsTab('plan'); setPage('settings'); }
    }, 300);
    if (b === 'cancelled') setTimeout(() => {
      if (after) { toast('No problem: you’re on Free. Upgrade any time in Settings → Plan.'); setSignup({ site: after.site, connect: after.connect }); }
    }, 300);
    if (b === 'new-brand') {
      setTimeout(() => toast('Setting up your new brand…'), 300);
      // The brand is created by Stripe's webhook: look for it for up to half a minute.
      const before = Date.now();
      const poll = async () => {
        const { data } = await supabase.from('workspace_members').select('workspace_id, created_at').eq('user_id', userId).eq('role', 'owner').order('created_at', { ascending: false }).limit(1);
        const newest = data?.[0];
        if (newest && Date.parse(newest.created_at) > before - 5 * 60e3) { await loadWorkspaces(newest.workspace_id); setPage('brand'); toast('Your new brand is ready. Start with its brand kit.'); return; }
        if (Date.now() - before < 30e3) setTimeout(poll, 2500); else toast('Payment done. Your new brand will appear in a moment; refresh if it doesn’t.');
      };
      setTimeout(poll, 1500);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // This brand's plan (members can read it; only Stripe's webhook writes it).
  useEffect(() => {
    if (!ws) return;
    setPlan('free');
    supabase.from('workspace_billing').select('plan, subscription_status').eq('workspace_id', ws).maybeSingle().then(({ data }) => setPlan(effectivePlan(data)));
  }, [ws, page]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail || {};
      setLimitHit({ message: d.message || 'This brand has used its Studio designs for this month.', reason: d.reason });
      // Free and out of designs: the upgrade pop-up, once per visit.
      if (d.reason === 'allowance' && !shownDesignsUpsell.current) { shownDesignsUpsell.current = true; setUpgrade({ reason: 'designs' }); setModal('upgrade'); }
    };
    const up = (e: Event) => { setUpgrade((e as CustomEvent).detail || { reason: 'general' }); setModal('upgrade'); };
    window.addEventListener('mise:limit', on);
    window.addEventListener('mise:upgrade', up);
    return () => { window.removeEventListener('mise:limit', on); window.removeEventListener('mise:upgrade', up); };
  }, []);

  // Coming back from connecting Box: open the import window on the Box browser.
  useEffect(() => {
    const u = new URL(location.href);
    if (u.searchParams.get('import') !== 'box') return;
    const r = u.searchParams.get('result');
    u.searchParams.delete('import'); u.searchParams.delete('result');
    history.replaceState({}, '', u);
    if (r === 'connected') { setBoxReturn(true); setModal('import'); }
    else setTimeout(() => toast(r === 'cancelled' ? 'Box wasn’t connected.' : 'Couldn’t connect Box. Try again.'), 300);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [settingsTab, setSettingsTab] = useState<'workspace' | 'plan' | 'members' | 'claude' | 'help'>('workspace');
  const [upgrade, setUpgrade] = useState<UpgradeAsk | null>(null);  // the upgrade pop-up, and why it opened
  const [limitHit, setLimitHit] = useState<{ message: string; reason?: string } | null>(null);  // out of Studio designs this month
  const [plan, setPlan] = useState<Plan>('free');
  const shownDesignsUpsell = useRef(false);
  const [view, setView] = useState('all'); // which kind the library shows
  const [addOpen, setAddOpen] = useState(false);
  // The Add menu opens to the left of its button; when the button has wrapped to the left edge,
  // it opens to the right instead, so it never slides under the sidebar.
  const addRef = useRef<HTMLDivElement>(null);
  const [addLeft, setAddLeft] = useState(false);
  const toggleAdd = () => {
    const el = addRef.current;
    if (!addOpen && el) {
      const r = el.getBoundingClientRect();
      const edge = (el.closest('main') as HTMLElement | null)?.getBoundingClientRect().left ?? 0;
      setAddLeft(r.right - 300 < edge + 8);
    }
    setAddOpen(!addOpen);
  };
  const [wsOpen, setWsOpen] = useState(false);
  const [connected, setConnected] = useState(true);
  const [q, setQ] = useState('');
  // AI search: what's being searched (words + filters, which can come from Claude reading the query)
  // and the ranked results for it. Keyword matching shows instantly while these load.
  const [sq, setSq] = useState<{ q: string; text: string; filters: SearchFilters }>({ q: '', text: '', filters: {} });
  const [hits, setHits] = useState<{ key: string; ids: string[]; ms?: number; vector?: boolean } | null>(null);
  const [understanding, setUnderstanding] = useState(false);
  const searchOff = useRef(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [block, setBlock] = useState<any>(null);
  const [modal, setModal] = useState<string | null>(null);
  const [convertFrom, setConvertFrom] = useState<string | null>(null);
  const [sideOpen, setSideOpen] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [newWs, setNewWs] = useState<string | null>(null);
  const [origin, setOrigin] = useState('any');
  const [kitRow, setKitRow] = useState<BrandKitRow | null>(null);
  const [kitFor, setKitFor] = useState(''); // which workspace kitRow has been loaded for
  // From the landing page (?site=, ?plan=, ?connect=, or kept by the sign-in page): read once.
  const [signup, setSignup] = useState<{ site?: string; plan?: string; connect?: string } | null>(() => {
    if (typeof window === 'undefined') return null;
    const it: { site?: string; plan?: string; connect?: string } = {};
    try {
      const u = new URL(location.href);
      for (const k of ['site', 'plan', 'connect'] as const) { const v = u.searchParams.get(k); if (v) { it[k] = v.slice(0, 200); u.searchParams.delete(k); } }
      if (Object.keys(it).length) history.replaceState({}, '', u);
      const kept = JSON.parse(localStorage.getItem('mise.signup') || 'null');
      localStorage.removeItem('mise.signup');
      if (!Object.keys(it).length && kept && Date.now() - kept.at < 864e5) Object.assign(it, { site: kept.site, plan: kept.plan, connect: kept.connect });
    } catch {}
    for (const k of Object.keys(it) as (keyof typeof it)[]) if (!it[k]) delete it[k];
    return Object.keys(it).length ? it : null;
  });
  const fromSignup = useRef(!!signup);
  const [autoSite, setAutoSite] = useState<string | null>(null);
  const [autoBrief, setAutoBrief] = useState<string | null>(null);
  const toastT = useRef<any>(null);
  const fileImg = useRef<HTMLInputElement>(null);
  const fileCsv = useRef<HTMLInputElement>(null);
  const fileDir = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const internalDrag = useRef(false);
  const dragN = useRef(0);

  const toast = useCallback((m: string) => {
    setToastMsg(m);
    clearTimeout(toastT.current);
    toastT.current = setTimeout(() => setToastMsg(''), 2800);
  }, []);

  // ---------- data ----------
  const loadWorkspaces = useCallback(async (select?: string) => {
    const { data } = await supabase.from('workspace_members').select('role, workspaces(id, name, created_at, figma_file_url, figma_file_key, figma_file_name)').eq('user_id', userId);
    const list = (data || []).map((r: any) => r.workspaces && { id: r.workspaces.id, name: r.workspaces.name, role: r.role, created_at: r.workspaces.created_at, figma_file_url: r.workspaces.figma_file_url, figma_file_key: r.workspaces.figma_file_key, figma_file_name: r.workspaces.figma_file_name })
      .filter(Boolean).sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)));
    setWorkspaces(list);
    let saved = '';
    try { saved = localStorage.getItem('emailsy.ws') || ''; } catch {}
    // A link to a brand (?brand=<id>, from Claude) picks it.
    try {
      const u = new URL(location.href);
      const b = u.searchParams.get('brand');
      if (b) { u.searchParams.delete('brand'); history.replaceState({}, '', u); if (list.some((w: Ws) => w.id === b)) saved = b; }
    } catch {}
    const pick = select || (list.some((w: Ws) => w.id === saved) ? saved : list[0]?.id) || '';
    setWs((cur) => (select ? select : cur && list.some((w: Ws) => w.id === cur) ? cur : pick));
  }, [supabase, userId]);

  const loadAssets = useCallback(async (wsId: string) => {
    if (!wsId) return;
    const { data, error } = await supabase.from('assets').select('*').eq('workspace_id', wsId).order('created_at', { ascending: false }).limit(2000);
    if (error) toast('Couldn’t load your library. Reload to try again.');
    setItems((data as Asset[]) || []);
    setReady(true);
  }, [supabase, toast]);

  // Editors have their own address (?asset=, ?block=, ?product=), so Back closes them and links open them.
  const setUrl = useCallback((key: 'asset' | 'block' | 'product' | null, id: string | null, replace = false) => {
    try {
      const u = new URL(location.href);
      for (const k of ['asset', 'block', 'product']) u.searchParams.delete(k);
      if (key && id) u.searchParams.set(key, id);
      if (u.toString() !== location.href) history[replace || !id ? 'replaceState' : 'pushState']({}, '', u);
    } catch {}
  }, []);
  const openEditor = useCallback((id: string | null, replace = false) => {
    setOpenId(id);
    if (id) setBlock(null);
    setUrl(id ? 'asset' : null, id, replace);
  }, [setUrl]);
  // Blocks and product cards open in the block editor (a draft object, saved or not).
  const showBlock = useCallback((d: any, replace = false) => {
    setOpenId(null);
    setBlock(d);
    if (d?.id) setUrl(d.kind === 'product' ? 'product' : 'block', d.id, replace); else setUrl(null, null, true);
  }, [setUrl]);
  const closeBlock = useCallback(() => { setBlock(null); setUrl(null, null); }, [setUrl]);
  // What the address asks for; opened once the asset is loaded (and after switching workspace).
  const pending = useRef<{ key: string; id: string } | null>(null);
  const [tick, setTick] = useState(0);
  const readUrl = useCallback(() => {
    const q = new URL(location.href).searchParams;
    for (const key of ['asset', 'block', 'product']) { const id = q.get(key); if (id) return { key, id }; }
    return null;
  }, []);
  useEffect(() => {
    const pop = () => { const r = readUrl(); setOpenId(null); setBlock(null); pending.current = r; setTick((t) => t + 1); };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, [readUrl]);
  const linked = useRef(false);
  useEffect(() => {
    if (linked.current || !workspaces.length) return;
    linked.current = true;
    const r = readUrl();
    if (!r) return;
    supabase.from('assets').select('id, workspace_id').eq('id', r.id).maybeSingle().then(({ data }) => {
      if (!data) { setUrl(null, null, true); toast('That isn’t in your workspaces any more.'); return; }
      pending.current = r;
      setWs(data.workspace_id);
      setTick((t) => t + 1);
    });
  }, [workspaces, supabase, readUrl, setUrl, toast]);

  const loadKit = useCallback(async (wsId: string) => {
    if (!wsId) return;
    const { data } = await supabase.from('brand_kits').select('*').eq('workspace_id', wsId).maybeSingle();
    setKitRow((data as BrandKitRow) || null);
    setKitFor(wsId);
  }, [supabase]);

  useEffect(() => { loadWorkspaces(); }, [loadWorkspaces]);
  // Has Claude ever used one of this user's connector links?
  useEffect(() => {
    supabase.from('api_keys').select('last_used_at').not('last_used_at', 'is', null).limit(1).then(({ data }) => setConnected(!!data?.length));
  }, [supabase, view]);
  const loadFolders = useCallback(async (wsId: string) => {
    const { data } = await supabase.from('folders').select('id, name').eq('workspace_id', wsId).order('name');
    setFolders(data || []);
  }, [supabase]);

  const loadCollections = useCallback(async (wsId: string) => {
    const { data } = await supabase.from('collections').select('*').eq('workspace_id', wsId).order('position').order('created_at');
    setCollections((data as Collection[]) || []);
  }, [supabase]);

  // Tell the server there's something new to organise (it also checks every 20 seconds).
  const kickTag = useCallback(() => {
    if (!ws) return;
    fetch('/api/jobs/tag', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace_id: ws, action: 'kick' }) }).catch(() => {});
  }, [ws]);

  useEffect(() => {
    if (!ws) return;
    try { localStorage.setItem('emailsy.ws', ws); } catch {}
    setReady(false);
    setKitRow(null);
    loadAssets(ws);
    loadKit(ws);
    loadFolders(ws);
    loadCollections(ws);
    setCollection(null);
    // Auto-organise updates many rows in a row: reload at most about once a second.
    let t: any = null;
    const soon = () => { clearTimeout(t); t = setTimeout(() => loadAssets(ws), 900); };
    const ch = supabase
      .channel('assets-' + ws)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assets', filter: `workspace_id=eq.${ws}` }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'brand_kits', filter: `workspace_id=eq.${ws}` }, () => loadKit(ws))
      .subscribe();
    return () => { clearTimeout(t); supabase.removeChannel(ch); };
  }, [ws, supabase, loadAssets, loadKit]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const r = pending.current;
    if (!r || !ready) return;
    const it = items.find((i) => i.id === r.id);
    if (!it) return;
    pending.current = null;
    if (r.key === 'asset') { setOpenId(it.id); setBlock(null); }
    else if (it.kind === 'product') showBlock(productDraft(it), true);
    else showBlock(blockDraft(it), true);
  }, [items, ready, tick, showBlock]);

  // Private bucket: sign every image path we need to show. Links last 6 hours and are all renewed
  // after 5, so a tab left open still hands Figma a working link when an image is dragged or copied.
  const SIGN_TTL = 6 * 3600, RENEW_MS = 5 * 3600e3;
  const signedAt = useRef(0);
  useEffect(() => {
    const paths = new Set<string>();
    for (const a of items) {
      if (a.storage_path) paths.add(a.storage_path);
      for (const s of Object.values(a.images || {}) as any[]) { if (s?.path) paths.add(s.path); if (s?.original_path) paths.add(s.original_path); }
    }
    const missing = [...paths].filter((p) => !urls[p]);
    if (!missing.length) return;
    if (!signedAt.current) signedAt.current = Date.now();
    supabase.storage.from('assets').createSignedUrls(missing, SIGN_TTL).then(({ data }) => {
      if (!data) return;
      setUrls((u) => {
        const next = { ...u };
        for (const d of data) if (d.signedUrl && d.path) next[d.path] = d.signedUrl;
        return next;
      });
    });
  }, [items, urls, supabase]); // eslint-disable-line react-hooks/exhaustive-deps
  const renewing = useRef(false);
  useEffect(() => {
    const renew = async () => {
      if (renewing.current || !signedAt.current || Date.now() - signedAt.current < RENEW_MS) return;
      renewing.current = true;
      const paths = Object.keys(urls);
      const next: Record<string, string> = {};
      for (let i = 0; i < paths.length; i += 1000) {
        const { data } = await supabase.storage.from('assets').createSignedUrls(paths.slice(i, i + 1000), SIGN_TTL);
        for (const d of data || []) if (d.signedUrl && d.path) next[d.path] = d.signedUrl;
      }
      signedAt.current = Date.now();
      setUrls((u) => ({ ...u, ...next }));
      renewing.current = false;
    };
    const t = setInterval(renew, 5 * 60e3);
    // A laptop waking up (timers pause while it sleeps): check straight away.
    const wake = () => { if (!document.hidden) renew(); };
    document.addEventListener('visibilitychange', wake); window.addEventListener('focus', wake);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', wake); window.removeEventListener('focus', wake); };
  }, [urls, supabase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fingerprint files that don't have one yet (added from a cloud drive, a feed, Claude, or before
  // duplicate checks existed), a few at a time while the library is open.
  const hashing = useRef(false);
  useEffect(() => {
    if (hashing.current || !ready) return;
    const todo = items.filter((i) => ['image', 'logo', 'product'].includes(i.kind) && i.storage_path && !i.phash && (i.images?.email?.path ? urls[i.images.email.path] : urls[i.storage_path])).slice(0, 12);
    if (!todo.length) return;
    hashing.current = true;
    (async () => {
      const known = items.filter((i) => i.phash && i.phash !== '-');
      for (const a of todo) {
        if (document.hidden) break;
        let hash: string | null = null;
        if (!/svg/.test(a.mime || '')) { try { hash = dhash(await loadImg(urls[a.images?.email?.path] || urls[a.storage_path])); } catch {} }
        const dup = hash ? findDuplicate(hash, known, a) : null;
        await supabase.from('assets').update({ phash: hash || '-', ...(dup && !a.duplicate_ok ? { duplicate_of: dup.id } : {}) }).eq('id', a.id);
        if (hash) known.push({ ...a, phash: hash });
        setItems((list) => list.map((i) => (i.id === a.id ? { ...i, phash: hash || '-', ...(dup && !a.duplicate_ok ? { duplicate_of: dup.id } : {}) } : i)));
      }
      hashing.current = false;
    })();
  }, [items, urls, ready, supabase]);

  const srcOf = useCallback((a?: Asset | null) => (a?.storage_path ? urls[a.storage_path] || null : null), [urls]);
  // The email-ready copy when there is one (what gets dragged into Figma).
  const emailSrcOf = useCallback((a?: Asset | null) => (a?.images?.email?.path && urls[a.images.email.path]) || srcOf(a), [urls, srcOf]);
  const itemById = useCallback((id?: string | null) => items.find((i) => i.id === id), [items]);
  const curWs = workspaces.find((w) => w.id === ws);
  const counts = useMemo(() => Object.fromEntries(['all', ...KINDS].map((k) => [k, k === 'all' ? items.filter((i) => i.kind !== 'block').length : items.filter((i) => i.kind === k).length])), [items]);
  // Which blocks use each asset (by image source or product).
  const usedIn = useMemo(() => {
    const m: Record<string, Asset[]> = {};
    for (const b of items) {
      if (b.kind !== 'block') continue;
      const ids = new Set<string>();
      if (b.product_id) ids.add(b.product_id);
      for (const s of Object.values(b.images || {}) as any[]) if (s?.source_asset_id) ids.add(s.source_asset_id);
      for (const id of ids) (m[id] ||= []).push(b);
    }
    return m;
  }, [items]);
  const showOrigins = !['product', 'block'].includes(view);
  const curColl = collection ? collections.find((c) => c.id === collection) || null : null;
  // Smart collections with words match by meaning: ask the AI search which files they find, and again as files arrive.
  const [collHits, setCollHits] = useState<Record<string, Set<string>>>({});
  const collSig = collections.map((c) => c.id + JSON.stringify(collectionQuery(c.rules))).join('|');
  const itemSig = items.length + ':' + items.filter((i) => i.ai_status === 'done').length;
  useEffect(() => {
    if (!ws || searchOff.current) return;
    const want = collections.filter((c) => collectionQuery(c.rules));
    if (!want.length) return;
    let gone = false;
    const timer = setTimeout(async () => {
      const got: Record<string, Set<string>> = {};
      await Promise.all(want.map(async (c) => {
        const cq = collectionQuery(c.rules)!;
        const r = await fetch('/api/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace_id: ws, q: cq.q, filters: cq.filters }) }).catch(() => null);
        const j = r?.ok ? await r.json().catch(() => null) : null;
        if (j?.hits) got[c.id] = new Set(j.hits.map((h: any) => h.id));
      }));
      if (!gone) setCollHits((cur) => ({ ...cur, ...got }));
    }, 400);
    return () => { gone = true; clearTimeout(timer); };
  }, [ws, collSig, itemSig]); // eslint-disable-line react-hooks/exhaustive-deps
  const inFolder = useCallback((it: Asset) => (curColl ? matchesRules(it, curColl.rules, collHits[curColl.id]) : folder === 'all' || it.folder_id === folder), [folder, curColl, collHits]);
  // A product flagged as a copy of another product is a false alarm (similar product shots): ignore it.
  const isDupe = useCallback((i: Asset) => !!i.duplicate_of && !i.duplicate_ok && !(i.kind === 'product' && items.find((x) => x.id === i.duplicate_of)?.kind === 'product'), [items]);
  const dupes = useMemo(() => items.filter(isDupe).length, [items, isDupe]);
  const collCounts = useMemo(() => Object.fromEntries(collections.map((c) => [c.id, items.filter((i) => matchesRules(i, c.rules, collHits[c.id])).length])), [collections, items, collHits]);
  const suggestions = useMemo(() => suggestCollections(items, collections), [items, collections]);
  const hay = useMemo(() => new Map(items.map((i) => [i.id, haystack(i)])), [items]);
  const inView = useCallback((it: Asset) => inFolder(it) && (view === 'all' || tabOf(it) === view), [view, inFolder]);
  const tabCounts = useMemo(() => { const inF = items.filter((i) => inFolder(i) && isAvailable(i)); const m: Record<string, number> = { all: inF.length }; for (const i of inF) { const t = tabOf(i); m[t] = (m[t] || 0) + 1; } return m; }, [items, inFolder]);
  const folderCounts = useMemo(() => { const m: Record<string, number> = {}; for (const i of items) if (i.folder_id) m[i.folder_id] = (m[i.folder_id] || 0) + 1; return m; }, [items]);
  const drafts = useMemo(() => items.filter((i) => i.status === 'draft').length, [items]);
  const unavailable = useMemo(() => items.filter((i) => !isAvailable(i)).length, [items]);
  const fileCount = useMemo(() => items.filter(countsAsFile).length, [items]);
  // Review: what Mise did on its own that needs a person. It's the home whenever something's waiting.
  const toReview = useMemo(() => reviewQueue(items, kitRow).count, [items, kitRow]);
  const landed = useRef(false);
  useEffect(() => {
    if (landed.current || !ready) return;
    landed.current = true;
    if (fromSignup.current) return; // the landing page's request decides where to go
    const u = new URL(location.href);
    if (u.searchParams.has('review')) { u.searchParams.delete('review'); history.replaceState({}, '', u); setPage('review'); return; }
    if (toReview > 0 && !u.searchParams.toString()) setPage((p) => (p === 'library' ? 'review' : p));
  }, [ready, toReview]);
  // ---------- AI search ----------
  // Typing: reset to the plain words. 3+ words: also ask Claude to read the query into filters.
  useEffect(() => {
    const t = q.trim();
    setSq((cur) => (cur.q === t ? cur : { q: t, text: t, filters: {} }));
    setUnderstanding(false);
    if (!t || !ws || searchOff.current || t.split(/\s+/).length < 3) return;
    const timer = setTimeout(async () => {
      setUnderstanding(true);
      const r = await fetch('/api/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace_id: ws, q: t, understand: true }) }).catch(() => null);
      const j = r?.ok ? await r.json().catch(() => null) : null;
      setUnderstanding(false);
      if (!j || !j.understood) return;
      setSq((cur) => (cur.q === t ? { q: t, text: j.text, filters: j.filters || {} } : cur));
      setHits({ key: searchKey(j.text, j.filters || {}), ids: (j.hits || []).map((h: any) => h.id), ms: j.ms, vector: j.vector });
    }, 450);
    return () => clearTimeout(timer);
  }, [q, ws]);
  // The ranked search for the current words and filters (fast: no Claude step).
  const curKey = searchKey(sq.text, sq.filters);
  const wantKey = useRef('');
  useEffect(() => {
    wantKey.current = curKey;
    if (!sq.q || !ws || searchOff.current) return;
    const key = curKey;
    const timer = setTimeout(async () => {
      const r = await fetch('/api/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace_id: ws, q: sq.text, filters: sq.filters }) }).catch(() => null);
      if (r && (r.status === 500 || r.status === 404)) { searchOff.current = true; return; } // not set up yet: keyword matching only
      const j = r?.ok ? await r.json().catch(() => null) : null;
      if (j && wantKey.current === key) setHits({ key, ids: (j.hits || []).map((h: any) => h.id), ms: j.ms, vector: j.vector });
    }, 160);
    return () => clearTimeout(timer);
  }, [curKey, ws]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const chips = useMemo(() => chipsOf(sq.filters), [sq.filters]);

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    const o = showOrigins ? origin : 'any';
    // Archived, expired and obsolete files only show under "No longer available".
    const keep = (it: Asset) => inView(it) && (o === 'unavailable' ? !isAvailable(it) : isAvailable(it) && (o === 'any' || (o === 'draft' ? it.status === 'draft' : o === 'dupes' ? isDupe(it) : originOf(it) === o)));
    if (s && hits && hits.key === curKey) {
      // Best matches first, then anything else whose words match (e.g. not made searchable yet).
      const ranked = hits.ids.map((id) => byId.get(id)).filter((it): it is Asset => !!it && keep(it));
      if (chips.length) return ranked;
      const seen = new Set(ranked.map((i) => i.id));
      return [...ranked, ...items.filter((it) => !seen.has(it.id) && keep(it) && matchesQuery(it, s, hay.get(it.id)))];
    }
    return items.filter((it) => keep(it) && (!s || matchesQuery(it, s, hay.get(it.id))));
  }, [items, inView, q, origin, showOrigins, hay, hits, curKey, byId, chips.length, isDupe]);

  async function copyTile(it: Asset) {
    const u = emailSrcOf(it);
    if (!u) return;
    try { await copyImageFrom(u); toast('Copied. Press ⌘V in Figma (or select a layer and ⌘⇧R to replace its image).'); }
    catch { toast('Your browser blocked copying. Open the image and use Download instead.'); }
  }

  // ---------- writes ----------
  async function patchAsset(id: string, patch: Record<string, any>) {
    setItems((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    const { error } = await supabase.from('assets').update(patch).eq('id', id);
    if (error) { toast('Couldn’t save that change. Try again.'); loadAssets(ws); return false; }
    return true;
  }

  async function deleteAsset(a: Asset) {
    const paths: string[] = [];
    const { data: old } = await supabase.from('asset_versions').select('storage_path, images').eq('asset_id', a.id);
    for (const v of (old || []) as any[]) { if (v.storage_path) paths.push(v.storage_path); if (v.images?.email?.path) paths.push(v.images.email.path); }
    const referenced = (p: string) => items.some((o) => o.id !== a.id && Object.values(o.images || {}).some((s: any) => s?.original_path === p || s?.path === p));
    if (a.storage_path && !referenced(a.storage_path)) paths.push(a.storage_path);
    for (const s of Object.values(a.images || {}) as any[]) if (s?.path && !referenced(s.path)) paths.push(s.path);
    const { error } = await supabase.from('assets').delete().eq('id', a.id);
    if (error) { toast('Couldn’t delete. Try again.'); return; }
    if (paths.length) await supabase.storage.from('assets').remove(paths);
    setItems((list) => list.filter((i) => i.id !== a.id));
    setOpenId(null); setBlock(null); setUrl(null, null, true);
    toast('Deleted');
  }

  // Upload an image as an asset, with an email-ready copy (max 1200px wide, compressed).
  // A file named after a product's PID attaches to that product instead.
  async function addImageAsset(file: File, opts: { kind?: string; attachToProduct?: boolean; folderId?: string | null } = {}): Promise<{ asset: Asset; img: HTMLImageElement | null } | null> {
    const ext = extOf(file);
    const type = file.type || (ext === 'svg' ? 'image/svg+xml' : ext === 'png' ? 'image/png' : 'image/jpeg');
    const big = tooBig({ size: file.size, type, name: file.name });
    if (big) { toast(big); return null; }
    if (plan === 'free' && fileCount >= FREE_FILES) { openUpgrade({ reason: 'files' }); return null; }
    const path = `${ws}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from('assets').upload(path, file, { contentType: type, upsert: false });
    if (error) { toast(/size|large|exceed/i.test(error.message) ? `${file.name} is too large to upload. Images can be up to ${mb(MAX_IMAGE_BYTES)}, videos ${mb(MAX_VIDEO_BYTES)}.` : `Couldn’t upload ${file.name}.`); return null; }
    const video = /^video\//.test(type);
    const local = URL.createObjectURL(file);
    let img: HTMLImageElement | null = null;
    if (!video) { try { img = await loadImg(local); } catch {} }
    URL.revokeObjectURL(local);
    const w = img?.naturalWidth || null, h = img?.naturalHeight || null;
    // Near-duplicate check against what's already here.
    const phash = img && !/svg/.test(type) ? dhash(img) : null;
    const dup = phash ? findDuplicate(phash, items) : null;
    const email = img ? await emailRendition(supabase, ws, img, { mime: type, bytes: file.size }) : null;
    const images = email ? { email } : {};
    const base = baseName(file.name || 'Pasted image');
    const prod = opts.attachToProduct === false || video ? null : items.find((i) => i.kind === 'product' && i.pid === base);
    if (prod) {
      await patchAsset(prod.id, { storage_path: path, mime: type, width: w, height: h, bytes: file.size, images: { ...(prod.images || {}), ...images }, phash: phash || '-' });
      toast(`Attached to ${prod.name}`);
      return { asset: { ...prod, storage_path: path }, img };
    }
    const kind = opts.kind || (video ? 'video' : /logo|wordmark|brandmark/i.test(base) || type === 'image/svg+xml' ? 'logo' : 'image');
    const { data, error: e2 } = await supabase.from('assets').insert({
      workspace_id: ws, kind, name: base.replace(/[-_]+/g, ' ').slice(0, 120) || 'Image', storage_path: path, mime: type,
      folder_id: opts.folderId !== undefined ? opts.folderId : folder !== 'all' ? folder : null,
      width: w, height: h, bytes: file.size, images, created_by: userId,
      phash: phash || (video ? null : '-'), duplicate_of: dup?.id || null,
    }).select('*').single();
    if (freeLimitOf(e2?.message) === 'files') { await supabase.storage.from('assets').remove([path]); openUpgrade({ reason: 'files' }); return null; }
    if (e2 || !data) { toast('Couldn’t save the image.'); return null; }
    if (dup) toast(`${base} looks like a copy of ${dup.name}. It’s flagged so you can decide.`);
    // Optional: AI alt text, filled in shortly after upload (skipped if no API key is set).
    if (img && !/svg/.test(type)) suggestAlt(img).then((alt) => { if (alt) supabase.from('assets').update({ fields: { ...(data.fields || {}), alt } }).eq('id', data.id).then(() => {}); });
    return { asset: data as Asset, img };
  }

  async function importFeed(file: File) {
    const read = fromRows(parseCSV(await file.text()));
    if ('error' in read) { toast(read.error); return; }
    // Existing products: copy the team edited (name, description) is kept; price, link and image follow the feed.
    const { data: existing } = await supabase.from('assets').select('id, pid, name, fields, feed_image, storage_path, created_by').eq('workspace_id', ws).eq('kind', 'product').limit(10000);
    const byPid = new Map((existing || []).map((e: any) => [e.pid, e]));
    const seen = new Set<string>();
    const products = read.map((p) => {
      if (seen.has(p.pid)) return null;
      seen.add(p.pid);
      const ex: any = byPid.get(p.pid);
      const edited: string[] = ex?.fields?.edited || [];
      const fields: Record<string, any> = { ...(ex?.fields || {}) };
      if (p.desc) {
        fields.feed_description = cleanText(p.desc).slice(0, 5000);
        if (!edited.includes('description')) fields.description = shortDescription(p.desc);
      }
      const imageChanged = !!ex && !!p.image && ex.feed_image !== p.image;
      return {
        workspace_id: ws, kind: 'product', origin: 'product_feed', pid: p.pid.slice(0, 120),
        name: edited.includes('name') && ex ? ex.name : (p.name || p.pid).slice(0, 120),
        price: p.price, link: p.link, feed_image: p.image || null, fields,
        storage_path: imageChanged ? null : ex?.storage_path ?? null,
        created_by: ex?.created_by || userId,
      };
    }).filter(Boolean) as any[];
    toast(`Importing ${products.length} products…`);
    for (let i = 0; i < products.length; i += 200) {
      const { error } = await supabase.from('assets').upsert(products.slice(i, i + 200), { onConflict: 'workspace_id,pid' });
      if (error) { toast(`Import stopped: ${error.message}`); return; }
    }
    setView('product'); setPage('library');
    loadAssets(ws);
    const withImages = products.filter((p) => p.feed_image).length;
    toast(`${products.length} products imported${withImages ? '. Fetching their images…' : ''}`);
    if (withImages) await fetchFeedImages();
  }

  // The server downloads image_link URLs into storage in batches (browsers can't read other sites' images).
  async function fetchFeedImages() {
    const skip: string[] = [];
    let done = 0, failed = 0;
    for (let round = 0; round < 60; round++) {
      const res = await fetch('/api/feed-images', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace_id: ws, skip }) }).catch(() => null);
      const json = res ? await res.json().catch(() => null) : null;
      if (!res?.ok || !json) { toast('Couldn’t fetch the product images. Try importing again.'); break; }
      done += json.done;
      for (const f of json.failed || []) { skip.push(f.id); failed++; }
      loadAssets(ws);
      if (json.limit) { openUpgrade({ reason: 'files' }); break; }
      if (!json.remaining || (!json.done && !(json.failed || []).length)) break;
      toast(`Fetched ${done} product images…`);
    }
    if (done) kickTag();
    toast(failed ? `${done} product images added. ${failed} couldn’t be downloaded; drop PID.jpg files to add them.` : `${done} product images added`);
  }

  // Upload files; a dropped or chosen folder becomes a Mise folder of the same name.
  async function ingest(files: FileList | File[], folderName?: string) {
    const list = [...files].filter((f) => !f.name.startsWith('.'));
    if (!list.length || !ws) return;
    let folderId: string | null | undefined = undefined;
    if (folderName) folderId = await ensureFolder(folderName);
    for (const f of list.filter((f) => /\.csv$/i.test(f.name) || f.type === 'text/csv')) await importFeed(f);
    let vids = list.filter((f) => /^video\/(mp4|webm|quicktime)/.test(f.type));
    let imgs = list.filter((f) => /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|svg)$/i.test(f.name));
    // Free: up to 50 files. Add what fits, then offer Pro for the rest.
    let held = 0;
    if (plan === 'free' && view !== 'block') {
      const room = Math.max(0, FREE_FILES - fileCount);
      held = Math.max(0, vids.length + imgs.length - room);
      if (held && !room) { openUpgrade({ reason: 'files', count: held }); return; }
      if (held) { vids = vids.slice(0, room); imgs = imgs.slice(0, room - vids.length); }
    }
    for (const f of vids) await addImageAsset(f, { kind: 'video', folderId });
    if (vids.length) loadAssets(ws);
    // In Blocks, images become blocks: ask for the block type, then create them.
    if (view === 'block' && imgs.length) { await blocksFromImages(imgs); return; }
    if (imgs.length > 1) toast(`Adding ${imgs.length} images…`);
    for (const f of imgs) await addImageAsset(f, { folderId });
    if (imgs.length) { loadAssets(ws); kickTag(); }
    if (folderId) { setFolder(folderId); setView('all'); toast(`${imgs.length + vids.length} files added to ${folderName}`); }
    if (imgs.length || vids.length) setPage((p) => (p === 'brand' ? p : 'library'));
    if (held) setTimeout(() => openUpgrade({ reason: 'files', count: held }), 600);
  }

  async function ensureFolder(name: string): Promise<string | null> {
    const n = name.trim().slice(0, 60);
    if (!n) return null;
    const existing = folders.find((f) => f.name.toLowerCase() === n.toLowerCase());
    if (existing) return existing.id;
    const { data, error } = await supabase.from('folders').insert({ workspace_id: ws, name: n, created_by: userId }).select('id, name').single();
    if (error || !data) { toast('Couldn’t create that folder.'); return null; }
    setFolders((f) => [...f, data].sort((a, b) => a.name.localeCompare(b.name)));
    return data.id;
  }
  async function moveToFolder(assetId: string, folderId: string | null) {
    const ok = await patchAsset(assetId, { folder_id: folderId });
    if (ok) toast(folderId ? `Moved to ${folders.find((f) => f.id === folderId)?.name}` : 'Moved out of the folder');
  }
  async function renameFolder(id: string) {
    const cur = folders.find((f) => f.id === id);
    const n = window.prompt('Rename folder', cur?.name || '')?.trim();
    if (!n || n === cur?.name) return;
    const { error } = await supabase.from('folders').update({ name: n.slice(0, 60) }).eq('id', id);
    if (error) { toast('Couldn’t rename it.'); return; }
    setFolders((f) => f.map((x) => (x.id === id ? { ...x, name: n } : x)));
  }
  async function deleteFolder(id: string) {
    const { error } = await supabase.from('folders').delete().eq('id', id);
    if (error) { toast('Couldn’t delete the folder.'); return; }
    setFolders((f) => f.filter((x) => x.id !== id));
    setItems((list) => list.map((i) => (i.folder_id === id ? { ...i, folder_id: null } : i)));
    setFolder('all');
    toast('Folder deleted. Its files are still in All files.');
  }

  async function saveCollection(c: { name: string; rules: Rules }, id?: string) {
    if (id) {
      const { error } = await supabase.from('collections').update(c).eq('id', id);
      if (error) { toast('Couldn’t save the collection.'); return; }
      setCollections((cs) => cs.map((x) => (x.id === id ? { ...x, ...c } : x)));
      toast('Collection saved');
    } else {
      const { data, error } = await supabase.from('collections').insert({ ...c, workspace_id: ws, position: collections.length, created_by: userId }).select('*').single();
      if (error || !data) { toast('Couldn’t create the collection.'); return; }
      setCollections((cs) => [...cs, data as Collection]);
      setCollection(data.id); setView('all'); setQ('');
      toast(`${c.name}: fills itself as files arrive`);
    }
    setCollForm(null);
  }
  async function deleteCollection(id: string) {
    const { error } = await supabase.from('collections').delete().eq('id', id);
    if (error) { toast('Couldn’t delete the collection.'); return; }
    setCollections((cs) => cs.filter((x) => x.id !== id));
    setCollection(null); setCollForm(null);
    toast('Collection deleted. The files are still in your library.');
  }

  // Edit mode saves: upload the file, make its email-ready copy and fingerprint, then either
  // a new version of the same asset (original kept) or a separate copy.
  async function saveEdit(a: Asset, r: { blob: Blob; mime: string; width: number; height: number; note: string }, asCopy: boolean) {
    const ext = r.mime.includes('png') ? 'png' : r.mime.includes('webp') ? 'webp' : 'jpg';
    const path = `${ws}/v/${crypto.randomUUID()}.${ext}`;
    const up = await supabase.storage.from('assets').upload(path, r.blob, { contentType: r.mime });
    if (up.error) { toast(/size|large/i.test(up.error.message) ? 'The edited file is over the size limit.' : 'Couldn’t upload the edit.'); return false; }
    let email: any = null, phash: string | null = null;
    const local = URL.createObjectURL(r.blob);
    try { const img = await loadImg(local); phash = dhash(img); email = await emailRendition(supabase, ws, img, { mime: r.mime, bytes: r.blob.size }); } catch {} finally { URL.revokeObjectURL(local); }
    const file = { storage_path: path, mime: r.mime, width: r.width, height: r.height, bytes: r.blob.size, images: email ? { email } : {}, phash: phash || '-' };
    const { data, error } = asCopy
      ? await supabase.rpc('asset_save_copy', { p_asset: a.id, p_file: file, p_name: `${a.name} (${r.width}×${r.height})`, p_note: r.note })
      : await supabase.rpc('asset_new_version', { p_asset: a.id, p_file: file, p_note: r.note });
    if (error || !data) { toast(`Couldn’t save the edit${error?.message ? `: ${error.message}` : ''}`); await supabase.storage.from('assets').remove([path, ...(email ? [email.path] : [])]); return false; }
    await loadAssets(ws);
    if (asCopy) { toast('Saved as a copy. The original is unchanged.'); openEditor((data as any).id, true); }
    else toast(`Saved as version ${(data as any).version}. The previous version is in the history.`);
    return true;
  }
  async function revertAsset(a: Asset, version: number) {
    if (plan === 'free') { openUpgrade({ reason: 'edit' }); return false; }
    const { error } = await supabase.rpc('asset_revert', { p_asset: a.id, p_version: version });
    if (error) { toast('Couldn’t restore that version.'); return false; }
    await loadAssets(ws);
    return true;
  }
  // A size the team can reuse in Edit, kept with the brand kit.
  async function addPreset(p: { name: string; w: number; h: number }) {
    const kit = normaliseKit(kitRow?.kit || { name: curWs?.name }, curWs?.name || '');
    const presets = [...(kit.presets || []).filter((x) => x.name.toLowerCase() !== p.name.toLowerCase()), p].slice(-30);
    const { error } = kitRow
      ? await supabase.from('brand_kits').update({ kit: { ...kit, presets } }).eq('workspace_id', ws)
      : await supabase.from('brand_kits').insert({ workspace_id: ws, kit: { ...kit, presets }, status: 'draft', source: { type: 'manual' } });
    if (error) { toast('Couldn’t add the size.'); return false; }
    await loadKit(ws);
    return true;
  }

  async function createWorkspace(name: string, quiet = false) {
    const { data, error } = await supabase.rpc('create_workspace', { ws_name: name });
    // Free covers one brand you own; the next one starts on Pro, through checkout.
    if (error && /FREE_BRAND_LIMIT/.test(error.message)) { setUpgrade({ reason: 'brand', brand: name }); setModal('upgrade'); return null; }
    if (error || !data) { toast('Couldn’t create the workspace.'); return null; }
    await loadWorkspaces((data as any).id);
    setView('all'); setPage('library');
    if (!quiet) toast(`${name} workspace created`);
    return (data as any).id as string;
  }

  // The landing page's request, once the brand and its kit are loaded:
  // a website builds the brand kit and then the first designs; connect=claude opens the connector link.
  useEffect(() => {
    if (!signup || !ready || !curWs || kitFor !== ws) return;
    const it = signup;
    setSignup(null);
    if (it.plan) { try { localStorage.setItem('mise.plan', it.plan); } catch {} }
    // From the pricing page's Pro button: straight to Stripe Checkout for this brand.
    // A website to build the kit from waits until they're back (see the ?billing= handler).
    if (it.plan && /pro/i.test(it.plan)) {
      if (curWs.role !== 'owner') { openSettings('plan'); return; }
      try { if (it.site) localStorage.setItem('mise.afterPay', JSON.stringify({ site: it.site, connect: it.connect, at: Date.now() })); } catch {}
      toast('Taking you to secure checkout…');
      fetch('/api/billing/checkout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workspace_id: curWs.id, interval: /year|annual/i.test(it.plan) ? 'year' : 'month' }) })
        .then(async (r) => {
          const j = await r.json().catch(() => ({}));
          if (r.ok && j.url) { location.href = j.url; return; }
          try { localStorage.removeItem('mise.afterPay'); } catch {}
          toast(j.error || 'Couldn’t open checkout. Upgrade from here when you’re ready.');
          if (it.site) setSignup({ site: it.site, connect: it.connect }); else openSettings('plan');
        })
        .catch(() => { toast('Couldn’t open checkout. Upgrade from here when you’re ready.'); openSettings('plan'); });
      return;
    }
    if (it.connect === 'claude' && !it.site) { openSettings('claude'); return; }
    if (!it.site) return;
    const host = (s?: string | null) => String(s || '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '').toLowerCase();
    const want = host(it.site);
    if (!kitRow) { setAutoSite(it.site); setPage('brand'); return; }
    if (host(kitRow.source?.url) === want) { setPage('brand'); toast('Your brand kit from ' + want + ' is already here.'); return; }
    // This brand already has its kit: make a new brand for the new website.
    const name = (want.split('.')[0] || 'New brand').replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase()).slice(0, 40);
    createWorkspace(name, true).then((id) => { if (id) { setAutoSite(it.site!); setPage('brand'); } });
  }, [signup, ready, curWs, kitFor, ws, kitRow]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- block flows ----------
  // Blocks use assets; they never move or replace them.
  // Render the email-ready crop of a source image for the block's image slot and save the block.
  async function blockFromImage(img: HTMLImageElement, src: { id?: string | null; storage_path: string; name: string }, type: string) {
    const bt = BLOCK_TYPES[type];
    const d = bt.fields.find((f) => f.type === 'image')!;
    const { w, h } = exportSize(d, img.naturalWidth, img.naturalHeight);
    const cv = drawFit(img, w, h, d.fit || 'cover', null, !d.png, d.fit === 'contain' ? 0.92 : 1);
    const type2 = d.png ? 'image/png' : 'image/jpeg';
    const blob = await toBlob(cv, type2, d.natural ? 0.92 : 0.86);
    const path = `${ws}/blocks/${crypto.randomUUID()}.${d.png ? 'png' : 'jpg'}`;
    const up = await supabase.storage.from('assets').upload(path, blob, { contentType: type2 });
    if (up.error) throw up.error;
    const { data, error } = await supabase.from('assets').insert({
      workspace_id: ws, kind: 'block', block_type: type, name: src.name || `${bt.name} block`, fields: {}, created_by: userId,
      images: { [d.k]: { path, width: w, height: h, format: d.png ? 'png' : 'jpg', bytes: blob.size, alt: src.name, source_asset_id: src.id || null, original_path: src.storage_path } },
    }).select('*').single();
    if (error) throw error;
    return data as Asset;
  }

  // Dropping images into Blocks: each one goes into your assets and gets a one-click block
  // (Hero if wide, Card otherwise). Switch the type in the block afterwards if needed.
  async function blocksFromImages(files: File[]) {
    toast(files.length > 1 ? `Making ${files.length} blocks…` : 'Making your block…');
    const made: Asset[] = [];
    for (const f of files) {
      try {
        const r = await addImageAsset(f, { attachToProduct: false });
        if (!r?.img) throw new Error('upload');
        made.push(await blockFromImage(r.img, r.asset as any, autoBlockType(r.img.naturalWidth, r.img.naturalHeight)));
      } catch { toast(`Couldn’t make a block from ${f.name}.`); }
    }
    if (!made.length) return;
    loadAssets(ws);
    setView('block'); setPage('library');
    if (made.length === 1) {
      const b = made[0];
      showBlock(blockDraft(b));
      toast(`${BLOCK_TYPES[b.block_type].name} block created. Add your copy.`);
    } else toast(`${made.length} blocks created`);
  }

  // A product opens as its email card: edit the copy right there.
  // Every asset opens on the same asset page (products too); blocks keep their own email editor.
  function openProduct(p: Asset) {
    openEditor(p.id);
  }

  // One click from an asset: logos make a Footer, images and products a Hero or Card.
  function useInBlock(a: Asset) {
    // Products are already cards, so from a product this makes a Hero or Card that features it.
    const type = a.kind === 'logo' ? 'footer' : autoBlockType(a.width, a.height);
    startBlock(type, a.id);
  }

  function startBlock(type: string, fromId?: string | null) {
    const bt = BLOCK_TYPES[type];
    const conv = fromId ? itemById(fromId) : null;
    const draft: any = { kind: 'block', block_type: type, name: `${bt.name} block`, fields: {}, images: {} };
    if (conv) {
      const slot = bt.fields.find((d) => d.type === 'image')!;
      draft.name = conv.name;
      if (conv.storage_path) draft.images[slot.k] = { source_asset_id: conv.id, alt: conv.fields?.alt || conv.name, dirty: true, original_path: conv.storage_path };
      if (conv.kind === 'product') {
        const pf = productAsBlock(conv).fields;
        draft.product_id = conv.id;
        Object.assign(draft.fields, type === 'product' ? pf : { headline: pf.name, body: pf.body, cta: pf.cta, link: pf.link });
      }
    }
    setModal(null); setConvertFrom(null);
    showBlock(draft);
  }

  // ---------- global events ----------
  useEffect(() => {
    const hasFiles = (e: DragEvent) => !internalDrag.current && [...(e.dataTransfer?.types || [])].includes('Files');
    const enter = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); dragN.current++; setDropping(true); };
    const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const leave = (e: DragEvent) => { if (!hasFiles(e)) return; if (--dragN.current <= 0) { dragN.current = 0; setDropping(false); } };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); dragN.current = 0; setDropping(false);
      // A dropped folder: read everything inside it and keep its name.
      const entries = [...(e.dataTransfer!.items || [])].map((i) => (i as any).webkitGetAsEntry?.()).filter(Boolean);
      const dir = entries.find((en: any) => en.isDirectory);
      if (dir) { readDir(dir).then((files) => ingest(files, dir.name)); return; }
      ingest(e.dataTransfer!.files);
    };
    const paste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input,textarea')) return;
      const files = [...(e.clipboardData?.files || [])];
      if (files.length) { e.preventDefault(); ingest(files); }
    };
    const start = (e: DragEvent) => {
      const img = (e.target as HTMLElement)?.closest?.('img[data-drag]') as HTMLImageElement | null;
      if (!img) return;
      internalDrag.current = true;
      try {
        const url = new URL(img.currentSrc || img.src, location.href).href;
        const png = img.dataset.png === '1' || /\.png(\?|$)/i.test(url);
        const name = (img.dataset.drag || 'image').replace(/[^\w.-]+/g, '-').replace(/\.(png|jpe?g)$/i, '') + (png ? '.png' : '.jpg');
        e.dataTransfer!.setData('DownloadURL', `image/${png ? 'png' : 'jpeg'}:${name}:${url}`);
        e.dataTransfer!.setData('text/uri-list', url);
        if (img.dataset.id) e.dataTransfer!.setData('application/x-emailsy-asset', img.dataset.id);
        e.dataTransfer!.effectAllowed = 'copyMove';
      } catch {}
    };
    const end = () => { internalDrag.current = false; };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Esc closes the top-most thing: a modal or block first, then the editor.
        // The block editor handles its own Esc (it checks for unsaved changes).
        if (shareTarget) setShareTarget(null); else if (addOpen || wsOpen) { setAddOpen(false); setWsOpen(false); } else if (selected.length && !openId && !block) setSelected([]); else if (modal || sideOpen) { setModal(null); setSideOpen(false); } else if (!block && openId) openEditor(null);
      }
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement as HTMLElement)?.tagName) && !(e.target as HTMLElement)?.isContentEditable) { e.preventDefault(); setPage('library'); setTimeout(() => searchRef.current?.focus(), 0); }
    };
    window.addEventListener('dragenter', enter); window.addEventListener('dragover', over); window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop); window.addEventListener('paste', paste); document.addEventListener('dragstart', start);
    document.addEventListener('dragend', end); document.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('dragenter', enter); window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop); window.removeEventListener('paste', paste); document.removeEventListener('dragstart', start);
      document.removeEventListener('dragend', end); document.removeEventListener('keydown', key);
    };
  });

  // Files the team added themselves (not the logo and photo the brand kit pulled from their site).
  const ownFiles = items.some((a) => a.kind !== 'block' && a.provenance?.via !== 'brand_kit');
  const go = (p: typeof page) => { setPage(p); setSideOpen(false); setWsOpen(false); };
  const library = (k: string, o = 'any') => { setView(k); setOrigin(o); go('library'); };
  // Free is a taster: sharing is on Pro, so asking to share opens the upgrade pop-up instead.
  useEffect(() => {
    if (shareTarget && plan === 'free') { setShareTarget(null); openUpgrade({ reason: 'share' }); }
  }, [shareTarget, plan]); // eslint-disable-line react-hooks/exhaustive-deps

  const openSettings = (t: typeof settingsTab) => { setSettingsTab(t); go('settings'); };
  const wsIndex = workspaces.findIndex((w) => w.id === ws);
  const needsSetup = !connected || !curWs?.figma_file_key;
  const openAsset = openId ? itemById(openId) : null;
  // Prev/next walk the assets currently shown (images, logos and products with an image).
  const walk = useMemo(() => visible.filter((i) => i.kind !== 'block'), [visible]);
  const at = openAsset ? walk.findIndex((i) => i.id === openAsset.id) : -1;
  // In the block editor, prev/next walk the blocks (or products) currently shown.
  const bWalk = useMemo(() => (block ? visible.filter((i) => i.kind === (block.kind === 'product' ? 'product' : 'block')) : []), [visible, block]);
  const bAt = block?.id ? bWalk.findIndex((i) => i.id === block.id) : -1;
  const openWalk = (it: Asset) => showBlock(it.kind === 'product' ? productDraft(it) : blockDraft(it), true);

  // ---------- render ----------
  return (
    <div className="app">
      <aside className={'side' + (sideOpen ? ' open' : '')} aria-label="Navigation">
        <div className="mise-logo" aria-label="Mise"><span className="wordmark">Mise<i aria-hidden /></span></div>
        <div className="wsw">
          <button className="wsw-btn" type="button" aria-expanded={wsOpen} onClick={() => setWsOpen((o) => !o)}>
            <span className="dot" style={{ background: WS_COLORS[Math.max(0, wsIndex) % WS_COLORS.length] }}>{(curWs?.name[0] || 'E').toUpperCase()}</span>
            <span className="wsw-name"><small>Brand</small><b>{curWs?.name || '…'}</b></span>
            <Icon.Chevron />
          </button>
          {wsOpen && (
            <div className="wsw-menu" role="menu">
              {workspaces.map((w, i) => (
                <button key={w.id} type="button" role="menuitem" aria-current={w.id === ws} onClick={() => { setWs(w.id); setFolder('all'); go('library'); }}>
                  <span className="dot" style={{ background: WS_COLORS[i % WS_COLORS.length] }}>{(w.name[0] || '?').toUpperCase()}</span>{w.name}{w.id === ws && <em>✓</em>}
                </button>
              ))}
              {newWs === null ? (
                <button type="button" role="menuitem" className="muted" onClick={() => setNewWs('')}><Icon.Plus size={16} />New brand</button>
              ) : (
                <form className="newws" onSubmit={(e) => { e.preventDefault(); const n = newWs.trim(); if (n) createWorkspace(n); setNewWs(null); setWsOpen(false); }}>
                  <input className="in" autoFocus value={newWs} maxLength={40} placeholder="Brand name" onChange={(e) => setNewWs(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setNewWs(null)} />
                  <button className="btn" type="submit">Add</button>
                </form>
              )}
            </div>
          )}
        </div>

        <nav className="mainnav">
          <button className="nav big" type="button" aria-current={page === 'review'} onClick={() => go('review')}><Icon.Check />Review
            {toReview > 0 ? <span className="count pill-n" title="Things that need you">{toReview}</span> : null}
          </button>
          <button className="nav big" type="button" aria-current={page === 'library'} onClick={() => library(view === 'all' ? 'all' : view)}><Icon.Image />Assets</button>
          <button className="nav big" type="button" aria-current={page === 'create'} onClick={() => go('create')}><Icon.Sparkle />Create</button>
          <button className="nav big" type="button" aria-current={page === 'sharing'} onClick={() => go('sharing')}><Icon.Share />Sharing</button>
          <button className="nav big" type="button" aria-current={page === 'brand'} onClick={() => go('brand')}><Icon.Palette />Brand kit
            {kitRow?.status === 'approved' ? null : <span className="count dotnote" title={kitRow ? 'Draft, not approved yet' : 'Not set up yet'}>•</span>}
          </button>
        </nav>

        <div className="fill" />
        <button className="nav" type="button" onClick={() => setModal('feedback')}><Icon.Chat />Feedback</button>
        <button className="nav" type="button" aria-current={page === 'settings'} onClick={() => openSettings(!connected ? 'claude' : 'workspace')}><Icon.Settings />Settings
          {needsSetup && <span className="count dotnote" title={!connected ? 'Claude isn’t connected yet' : 'No Figma file connected'}>•</span>}
        </button>
        <div className="me"><span title={email}>{email}</span><button type="button" onClick={async () => { await supabase.auth.signOut(); location.href = '/login'; }}>Sign out</button></div>
      </aside>
      {wsOpen && <div className="clickaway" onClick={() => setWsOpen(false)} />}

      <main>
        <div className="bar mobile-only">
          <button className="menu" type="button" aria-label="Open navigation" onClick={() => setSideOpen(true)}><Icon.Menu /></button>
          <div className="crumb">{curWs?.name || '…'}<Icon.Chevron /><b>{page === 'review' ? 'Review' : page === 'create' ? 'Create' : page === 'library' ? 'Assets' : page === 'brand' ? 'Brand kit' : page === 'sharing' ? 'Sharing' : 'Settings'}</b></div>
        </div>

        <div className="content">
          {limitHit && (
            <div className="limit-banner" role="status">
              <span>{limitHit.message}</span>
              <span className="acts">
                <button className="btn" type="button" onClick={() => { const r = limitHit.reason; setLimitHit(null); if (r === 'allowance') openUpgrade({ reason: 'designs' }); else openSettings('plan'); }}>{limitHit.reason === 'allowance' ? 'See Pro' : 'Raise the cap'}</button>
                <button className="btn quiet" type="button" onClick={() => setLimitHit(null)}>Dismiss</button>
              </span>
            </div>
          )}
          {page === 'review' && curWs ? (
            ready ? <Review items={items} kit={kitRow} thumbOf={emailSrcOf}
              onApprove={async (ids) => {
                setItems((list) => list.map((i) => (ids.includes(i.id) ? { ...i, status: 'approved' } : i)));
                const { error } = await supabase.from('assets').update({ status: 'approved' }).in('id', ids);
                if (error) { toast('Couldn’t approve. Try again.'); loadAssets(ws); return; }
                toast(ids.length === 1 ? 'Approved' : `${ids.length} approved`);
              }}
              onReject={deleteAsset}
              onKeepBoth={async (a) => { if (await patchAsset(a.id, { duplicate_ok: true })) toast('Kept both'); }}
              onFine={async (a) => { if (await patchAsset(a.id, { on_brand: true, on_brand_reason: 'Checked by a person', edited: [...new Set([...(a.edited || []), 'on_brand'])] })) toast('Marked as on-brand'); }}
              onRetry={async (a) => { if (await patchAsset(a.id, { ai_status: 'pending', ai_attempts: 0, ai_error: null })) { kickTag(); toast('Organising…'); } }}
              onOpen={(id) => openEditor(id)}
              onProducts={() => library('product')}
              onBrandKit={() => go('brand')}
              onLibrary={() => library('all')} /> : <p className="loading">Loading…</p>
          ) : page === 'create' && curWs ? (
            ready ? <Create ws={curWs} userId={userId} supabase={supabase} onSaved={() => loadAssets(ws)} items={items} urls={urls} kit={kitRow} connected={connected} toast={toast}
              autoBrief={autoBrief} onAutoUsed={() => setAutoBrief(null)}
              onConnect={() => openSettings('claude')} onBrandKit={() => go('brand')} onReview={() => library('all', 'draft')}
              onOpen={(a) => openEditor(a.id)} /> : <p className="loading">Loading…</p>
          ) : page === 'settings' && curWs ? (
            <div className="settings-page">
              <div className="head"><h1>Settings</h1></div>
              <div className="seg tabs" role="tablist">
                {([['workspace', 'Brand workspace'], ['plan', 'Plan & usage'], ['members', 'Team'], ['claude', 'Claude'], ['help', 'Help']] as const).map(([k, l]) => (
                  <button key={k} type="button" role="tab" aria-pressed={settingsTab === k} onClick={() => setSettingsTab(k)}>{l}{k === 'claude' && !connected ? ' •' : ''}</button>
                ))}
              </div>
              <div className="settings-body">
                {settingsTab === 'workspace' && <WorkspaceSettings supabase={supabase} ws={curWs} toast={toast} onSaved={() => loadWorkspaces(curWs.id)}
                  onDeleted={async () => {
                    const next = workspaces.find((w) => w.id !== curWs.id);
                    try { localStorage.removeItem('emailsy.ws'); } catch {}
                    if (next) { setWs(next.id); await loadWorkspaces(next.id); setPage('library'); setView('all'); setFolder('all'); }
                    else location.href = '/'; // no brands left: start fresh
                  }} />}
                {settingsTab === 'plan' && <PlanSettings key={curWs.id} ws={curWs} toast={toast} />}
                {settingsTab === 'members' && <Members supabase={supabase} ws={curWs} userId={userId} toast={toast} />}
                {settingsTab === 'claude' && <Connector supabase={supabase} toast={toast} full />}
                {settingsTab === 'help' && <div className="helpcols"><div><HelpFigma /></div><div><HelpFeed /></div></div>}
              </div>
            </div>
          ) : page === 'sharing' && curWs ? (
            <Sharing key={curWs.id} free={plan === 'free'} supabase={supabase} ws={curWs} items={items} folders={folders} collections={collections.map((c) => ({ id: c.id, name: c.name }))} toast={toast} />
          ) : page === 'brand' && curWs ? (
            ready ? <BrandKitView key={curWs.id} supabase={supabase} ws={curWs} userId={userId} row={kitRow} items={items} urls={urls} toast={toast} onChanged={() => { loadKit(ws); loadAssets(ws); loadWorkspaces(ws); }}
              autoSite={autoSite}
              onBuilt={async (name) => {
                setAutoSite(null);
                await Promise.all([loadKit(ws), loadAssets(ws)]);
                setAutoBrief(`A launch post introducing ${name}, made from our own photos and logo, for Instagram.`);
                setPage('create');
              }} /> : <p className="loading">Loading your brand kit…</p>
          ) : !ready ? (
            <p className="loading">Loading your library…</p>
          ) : (
            <>
              <div className="lib-head">
                <h1>{curColl ? curColl.name : folder === 'all' ? 'Assets' : folders.find((f) => f.id === folder)?.name || 'Assets'}</h1>
                {curColl && <span className="lib-fact">Smart collection · {describeRules(curColl.rules)} · <button type="button" className="linkish" onClick={() => setCollForm(curColl)}>Edit</button> · <button type="button" className="linkish" onClick={() => setShareTarget({ kind: 'collection', collection_id: curColl.id, title: curColl.name })}>Share</button></span>}
                {!curColl && folder !== 'all' && <span className="lib-fact">{folderCounts[folder] || 0} files · <button type="button" className="linkish" onClick={() => setShareTarget({ kind: 'folder', folder_id: folder, title: folders.find((f) => f.id === folder)?.name || 'Shared folder' })}>Share</button> · <button type="button" className="linkish" onClick={() => renameFolder(folder)}>Rename</button> · <button type="button" className="linkish" onClick={() => deleteFolder(folder)}>Delete folder</button></span>}
                <span className="spacer" />
                <label className="search" htmlFor="q"><Icon.Search size={15} /><input id="q" ref={searchRef} type="search" placeholder="Search: beach, blue bag, logo…" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} /><kbd>/</kbd></label>
                {q.trim() && <button className="btn quiet savesearch" type="button" title="Save this search as a smart collection" onClick={() => setCollForm({ name: q.trim().replace(/^./, (c) => c.toUpperCase()), rules: { text: q.trim(), ...(['image', 'logo', 'product', 'video'].includes(view) ? { kinds: [view] } : {}) } })}>Save search</button>}
                <div className="addwrap" ref={addRef}>
                  <button className="primary" type="button" aria-expanded={addOpen} onClick={toggleAdd}><Icon.Plus size={16} />Add</button>
                  {addOpen && (
                    <div className={'addmenu' + (addLeft ? ' left' : '')} role="menu" onClick={() => setAddOpen(false)}>
                      <button type="button" role="menuitem" onClick={() => fileImg.current?.click()}><Icon.Image /><span><b>Upload files</b><small>Images, logos, videos. Or drop them anywhere.</small></span></button>
                      <button type="button" role="menuitem" onClick={() => fileDir.current?.click()}><Icon.Folder /><span><b>Upload a folder</b><small>Keeps the folder’s name, like Dropbox</small></span></button>
                      <button type="button" role="menuitem" onClick={() => setModal('feeds')}><Icon.Table /><span><b>Add products</b><small>Connect Shopify, a feed link, or a CSV</small></span></button>
                      <button type="button" role="menuitem" onClick={() => setModal('import')}><Icon.Cloud /><span><b>Import from Drive, Dropbox or Box</b><small>Copy images and videos in, or a whole Box folder</small></span></button>
                      <hr />
                      <button type="button" role="menuitem" onClick={() => setNewFolder('')}><Icon.Plus /><span><b>New folder</b></span></button>
                      <button type="button" role="menuitem" onClick={() => setModal('blocktype')}><Icon.Blocks /><span><b>New email block</b><small>Hero, card, product, button, footer</small></span></button>
                    </div>
                  )}
                </div>
              </div>
              {addOpen && <div className="clickaway" onClick={() => setAddOpen(false)} />}
              {curWs && !q.trim() && folder === 'all' && !curColl && (
                <GettingStarted supabase={supabase} ws={curWs.id} items={items} kitStatus={kitRow?.status || null}
                  onBrandKit={() => go('brand')} onImport={() => setModal('import')} onUpload={() => fileImg.current?.click()} onCreate={() => go('create')} onSharing={() => go('sharing')} />
              )}

              {suggestions.length > 0 && collections.length === 0 && (
                <div className="suggest" aria-label="Suggested collections">
                  <span className="suggest-h"><Icon.Sparkle size={14} />Suggested collections</span>
                  {suggestions.map((sg) => (
                    <button key={sg.name} type="button" className="chip" title={describeRules(sg.rules)} onClick={() => saveCollection({ name: sg.name, rules: sg.rules })}>+ {sg.name}<span>{sg.count}</span></button>
                  ))}
                </div>
              )}

              {(folders.length > 0 || newFolder !== null || collections.length > 0 || suggestions.length > 0) && (
                <div className="folders" aria-label="Folders and collections">
                  {[{ id: 'all', name: 'All files' }, ...folders].map((f) => (
                    <button key={f.id} type="button" className={'folder' + (!curColl && folder === f.id ? ' on' : '') + (dropFolder === f.id ? ' drop' : '')} onClick={() => { setFolder(f.id); setCollection(null); setView('all'); }}
                      onDragOver={(e) => { if (e.dataTransfer.types.includes('application/x-emailsy-asset')) { e.preventDefault(); setDropFolder(f.id); } }}
                      onDragLeave={() => setDropFolder(null)}
                      onDrop={(e) => { const id = e.dataTransfer.getData('application/x-emailsy-asset'); setDropFolder(null); if (id) { e.preventDefault(); e.stopPropagation(); moveToFolder(id, f.id === 'all' ? null : f.id); } }}>
                      <Icon.Folder size={16} />{f.name}<span>{f.id === 'all' ? items.length : folderCounts[f.id] || 0}</span>
                    </button>
                  ))}
                  {collections.map((c) => (
                    <button key={c.id} type="button" className={'folder smart' + (collection === c.id ? ' on' : '')} title={`Smart collection: ${describeRules(c.rules)}`} onClick={() => { setCollection(c.id); setView('all'); }}>
                      <Icon.Sparkle size={15} />{c.name}<span>{collCounts[c.id] || 0}</span>
                    </button>
                  ))}
                  <button type="button" className="folder add" onClick={() => setCollForm({})}><Icon.Sparkle size={14} />Smart collection</button>
                  {newFolder === null ? (
                    <button type="button" className="folder add" onClick={() => setNewFolder('')}><Icon.Plus size={15} />Folder</button>
                  ) : (
                    <form className="folder-new" onSubmit={async (e) => { e.preventDefault(); const id = await ensureFolder(newFolder); setNewFolder(null); if (id) { setFolder(id); setView('all'); } }}>
                      <input className="in" autoFocus value={newFolder} maxLength={60} placeholder="Folder name" onChange={(e) => setNewFolder(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setNewFolder(null)} onBlur={() => !newFolder.trim() && setNewFolder(null)} />
                    </form>
                  )}
                </div>
              )}

              {items.length > 0 && <div className="lib-tabs">
                <div className="tabs-row" role="tablist" aria-label="Kind">
                  {TABS.filter((t) => t.id === 'all' || t.id === view || tabCounts[t.id] > 0).map((t) => (
                    <button key={t.id} type="button" role="tab" aria-pressed={view === t.id} onClick={() => setView(t.id)}>
                      {t.label}<span>{tabCounts[t.id] || 0}</span>
                    </button>
                  ))}
                </div>
                {showOrigins && (
                  <select className="in source" value={origin} onChange={(e) => setOrigin(e.target.value)} aria-label="Where assets came from">
                    {ORIGINS.filter(([k]) => (k !== 'product_feed' || view === 'all') && (k !== 'draft' || drafts || origin === 'draft') && (k !== 'dupes' || dupes || origin === 'dupes') && (k !== 'unavailable' || unavailable || origin === 'unavailable')).map(([k, l]) => (
                      <option key={k} value={k}>{k === 'any' ? 'From anywhere' : k === 'draft' ? `To review (${drafts})` : k === 'dupes' ? `Possible duplicates (${dupes})` : k === 'unavailable' ? `No longer available (${unavailable})` : k === 'generated' ? 'Made with Claude' : l}</option>
                    ))}
                  </select>
                )}
              </div>}

              {!q.trim() && <LibrarySync ws={ws} nudge={items.length} onProgress={() => loadAssets(ws)} onDetails={() => openSettings('plan')} toast={toast} />}

              {plan === 'free' && fileCount >= FREE_FILES - 10 && !q.trim() && (
                <div className="upsell-strip" role="status">
                  <span>{fileCount >= FREE_FILES
                    ? <><b>Your {FREE_FILES} free files are in.</b> Upgrade to Pro to add the rest of your library.</>
                    : <><b>{fileCount} of {FREE_FILES}</b> free files used.</>}</span>
                  <button className="btn" type="button" onClick={() => openUpgrade({ reason: 'files' })}>Upgrade to Pro</button>
                </div>
              )}

              {q.trim() && (chips.length > 0 || understanding || sq.text !== sq.q) && (
                <div className="qchips" aria-label="Search filters">
                  {understanding && <span className="qthinking">Reading your search…</span>}
                  {chips.map((c) => (
                    <button key={c.id} type="button" className="qchip" title="Remove this filter" onClick={() => setSq((cur) => ({ ...cur, filters: removeChip(cur.filters, c.id) }))}>{c.label}<span aria-hidden>×</span></button>
                  ))}
                  {!understanding && sq.text && sq.text !== sq.q && <span className="qtext">matching “{sq.text}”</span>}
                </div>
              )}

              {(!items.length || (!ownFiles && !q.trim() && view === 'all' && folder === 'all' && !curColl && origin === 'any')) ? (
                <>
                <div className="intake">
                  <button type="button" className="intake-drop" onClick={() => fileImg.current?.click()}>
                    <Icon.Upload size={30} />
                    <b>Drop everything here</b>
                    <span>Photos, logos, videos, whole folders. We size them, write alt text and file them for you.</span>
                  </button>
                  <div className="intake-sources">
                    <div className="src-h">Or bring them in from</div>
                    <button type="button" className="src" onClick={() => fileDir.current?.click()}><Icon.Folder /><span><b>A folder on your computer</b><small>Keeps the folder’s name</small></span></button>
                    <button type="button" className="src" onClick={() => setModal('feeds')}><Icon.Bag /><span><b>Your products</b><small>Connect Shopify, a feed link, or a CSV</small></span></button>
                    <button type="button" className="src" onClick={() => setModal('import')}><Icon.Cloud /><span><b>Google Drive, Dropbox or Box</b><small>Pick files, or import a whole Box folder</small></span></button>
                  </div>
                </div>
                {visible.length > 0 && (
                  <>
                    <div className="src-h kitfiles">From your brand kit</div>
                    <div className="grid masonry">
                      {visible.map((it) => (
                        <div key={it.id} className="selwrap"><Tile it={it} src={emailSrcOf(it)} urls={urls} used={(usedIn[it.id] || []).length} onOpen={() => openEditor(it.id)} onCopy={() => copyTile(it)} /></div>
                      ))}
                    </div>
                  </>
                )}
                </>
              ) : !visible.length ? (
                view === 'block' && !q ? (
                  <div className="empty small">
                    <Wire type="hero" />
                    <h2>No email blocks yet</h2>
                    <p>A block is an email module: images and copy together, built from your assets, ready for Claude to turn into a Figma component.</p>
                    <div className="row">
                      <button className="primary" type="button" onClick={() => setModal('blocktype')}><Icon.Plus size={16} />New block</button>
                    </div>
                  </div>
                ) : (
                  <p className="nomatch">{q ? `Nothing matches “${q}”.` : showOrigins && origin === 'generated' ? 'Nothing made with Claude yet. Head to Create and make something.' : showOrigins && origin !== 'any' ? 'Nothing here with that filter.' : `No ${tabLabel(view).toLowerCase()} yet. Drop some onto the page.`}</p>
                )
              ) : (
                <div className={'grid' + (['product', 'block', 'logo'].includes(view) ? '' : ' masonry')}>
                  {visible.map((it) => (
                    <div key={it.id} className={'selwrap' + (selected.includes(it.id) ? ' sel' : '') + (selected.length ? ' selecting' : '')}>
                      {it.kind !== 'block' && <button type="button" className="selbox" aria-label={selected.includes(it.id) ? `Deselect ${it.name}` : `Select ${it.name}`} aria-pressed={selected.includes(it.id)} onClick={(e) => { e.stopPropagation(); toggleSel(it.id); }}><Icon.Check size={13} /></button>}
                      <Tile it={it} src={emailSrcOf(it)} urls={urls} used={(usedIn[it.id] || []).length} onCopy={() => copyTile(it)} onOpen={() => (selected.length && it.kind !== 'block' ? toggleSel(it.id) : it.kind === 'block' ? showBlock(blockDraft(it)) : it.kind === 'product' ? openProduct(it) : openEditor(it.id))} />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </main>

      <input ref={fileImg} type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,video/mp4,video/webm,video/quicktime,.csv,text/csv" hidden onChange={(e) => { if (e.target.files) ingest(e.target.files); e.target.value = ''; }} />
      <input ref={fileDir} type="file" multiple hidden {...({ webkitdirectory: '', directory: '' } as any)} onChange={(e) => { const fl = e.target.files; if (fl?.length) { const name = ((fl[0] as any).webkitRelativePath || '').split('/')[0]; ingest(fl, name || undefined); } e.target.value = ''; }} />
      <input ref={fileCsv} type="file" accept=".csv,text/csv" hidden onChange={(e) => { if (e.target.files) ingest(e.target.files); e.target.value = ''; }} />
      {dropping && <div className="drop"><div><strong>{view === 'block' ? 'Drop to make blocks' : 'Drop to add'}</strong><span>{view === 'block' ? 'Each image goes into your assets and becomes a block: Hero if wide, Card otherwise.' : 'Images, logos, videos, or a product feed CSV'}</span></div></div>}
      {(modal || sideOpen) && <div className="scrim" onClick={() => { setModal(null); setSideOpen(false); }} />}

      {openAsset && (
        <AssetEditor
          key={openAsset.id}
          it={openAsset}
          src={srcOf(openAsset)}
          onClose={() => openEditor(null)}
          onPatch={(p) => patchAsset(openAsset.id, p)}
          onDelete={() => deleteAsset(openAsset)}
          pro={plan !== 'free'}
          replacements={items.filter((i) => i.kind === openAsset.kind && i.id !== openAsset.id && isAvailable(i)).map((i) => ({ id: i.id, name: i.name })).sort((a, b) => a.name.localeCompare(b.name))}
          onUpgrade={(reason) => { if (reason !== 'edit') openEditor(null); openUpgrade({ reason: reason === 'edit' ? 'edit' : 'lifecycle' }); }}
          usedIn={usedIn[openAsset.id] || []}
          onOpenBlock={(b) => showBlock(blockDraft(b))}
          onMakeBlock={() => useInBlock(openAsset)}
          onPrev={at > 0 ? () => openEditor(walk[at - 1].id, true) : undefined}
          onNext={at >= 0 && at < walk.length - 1 ? () => openEditor(walk[at + 1].id, true) : undefined}
          position={at >= 0 ? `${at + 1} of ${walk.length}` : undefined}
          toast={toast}
          folders={folders}
          figmaUrl={curWs?.figma_file_url}
          product={openAsset.product_id ? (() => { const p = itemById(openAsset.product_id); return p ? { id: p.id, name: p.name } : null; })() : null}
          suggested={openAsset.ai?.product?.id && !openAsset.product_id ? (() => { const p = itemById(openAsset.ai.product.id); return p ? { id: p.id, name: p.name } : null; })() : null}
          duplicate={isDupe(openAsset) ? (() => { const d = itemById(openAsset.duplicate_of); return d ? { id: d.id, name: d.name } : null; })() : null}
          onOpenAsset={(id) => { const a = itemById(id); if (!a) return; if (a.kind === 'product') openProduct(a); else openEditor(id); }}
          onRetag={async () => { if (await patchAsset(openAsset.id, { ai_status: 'pending', ai_attempts: 0, ai_error: null })) { kickTag(); toast('Organising…'); } }}
          supabase={supabase}
          kit={kitRow ? normaliseKit(kitRow.kit, curWs?.name || '') : null}
          onSaveEdit={(r, asCopy) => saveEdit(openAsset, r, asCopy)}
          onRevert={(v) => revertAsset(openAsset, v)}
          onAddPreset={addPreset}
          design={openAsset.provenance?.via === 'studio' && openAsset.provenance?.spec ? (() => {
            const sk = studioKit(curWs?.name || '', kitRow, items, urls);
            return { wsId: ws, brand: sk.brand, fonts: sk.fonts, srcOf: sk.srcOf, thumbOf: (a: Asset) => emailSrcOf(a) || undefined,
              library: items.filter((i) => (i.kind === 'image' || i.kind === 'product') && i.storage_path && i.status !== 'draft' && isAvailable(i) && i.provenance?.via !== 'studio') };
          })() : undefined}
          onDesignSaved={async (newId) => { await loadAssets(ws); if (newId) openEditor(newId, true); }}
          onShare={async () => {
            if (!openAsset.storage_path) { toast('Nothing to share yet.'); return null; }
            setShareTarget({ kind: 'assets', asset_ids: [openAsset.id], title: openAsset.name });
            return null;
          }}
          onEmailCopy={async () => {
            const path = openAsset.images?.email?.path || openAsset.storage_path;
            if (!path) return;
            if (lifecycleOf(openAsset) === 'expired') { toast('Its licence has expired, so it can’t be downloaded.'); return; }
            const name = openAsset.name.replace(/[^\w.-]+/g, '-').toLowerCase() + '-email.' + (path.split('.').pop() || 'jpg');
            const { data } = await supabase.storage.from('assets').createSignedUrl(path, 600, { download: name });
            if (data?.signedUrl) location.href = data.signedUrl;
          }}
        />
      )}

      {block && (
        <BlockEditor
          key={(block.kind || 'block') + (block.id || 'new')}
          product={block.kind === 'product' ? itemById(block.id) || null : null}
          onImageTools={() => openEditor(block.id)}
          onUseInBlock={() => { const p = itemById(block.id); if (p) startBlock(autoBlockType(p.width, p.height), p.id); }}
          onPrev={bAt > 0 ? () => openWalk(bWalk[bAt - 1]) : undefined}
          onNext={bAt >= 0 && bAt < bWalk.length - 1 ? () => openWalk(bWalk[bAt + 1]) : undefined}
          position={bAt >= 0 ? `${bAt + 1} of ${bWalk.length}` : undefined}
          draft={block}
          ws={ws}
          userId={userId}
          library={items}
          urls={urls}
          appUrl={appUrl}
          figmaFile={curWs?.figma_file_key ? { url: curWs.figma_file_url || '', name: curWs.figma_file_name || '' } : null}
          supabase={supabase}
          toast={toast}
          onClose={closeBlock}
          onSaved={(row, convertedFrom) => {
            setItems((list) => list.some((i) => i.id === row.id) ? list.map((i) => (i.id === row.id ? row : i)) : [row, ...list.filter((i) => i.id !== convertedFrom)]);
            if (row.kind === 'block') { setView('block'); setPage('library'); setUrl('block', row.id, true); }
          }}
          onDelete={(b) => deleteAsset(b.kind === 'product' ? itemById(b.id) || b : b)}
        />
      )}

      {modal === 'upgrade' && upgrade && curWs && <div className="scrim upsell-scrim" onClick={() => { setModal(null); setUpgrade(null); }} />}
      {modal === 'upgrade' && upgrade && curWs && (
        <Modal className="upsell-modal" onClose={() => { setModal(null); setUpgrade(null); }}>
          <UpgradeModal ws={curWs} ask={upgrade} toast={toast} onClose={() => { setModal(null); setUpgrade(null); }} />
        </Modal>
      )}
      {modal === 'feedback' && <Feedback ws={curWs?.id} page={page === 'settings' ? `settings/${settingsTab}` : page} onClose={() => setModal(null)} toast={toast} />}
      {modal === 'feeds' && curWs && (
        <Modal wide onClose={() => setModal(null)}>
          <ProductFeeds ws={ws} toast={toast} onCsv={() => { setModal(null); fileCsv.current?.click(); }}
            onDone={() => { loadAssets(ws); kickTag(); setView('product'); setPage('library'); }} />
        </Modal>
      )}
      {modal === 'import' && curWs && (
        <Modal onClose={() => { setModal(null); setBoxReturn(false); }}>
          <h2>Import from where your images live</h2>
          <ImportSources ws={ws} folderId={folder !== 'all' ? folder : null} folderName={folder !== 'all' ? folders.find((f) => f.id === folder)?.name : null}
            startBox={boxReturn} toast={toast}
            onDone={(landed) => { loadAssets(ws); loadFolders(ws); kickTag(); setPage('library'); setView('all'); setCollection(null); if (landed) setFolder(landed); }} />
        </Modal>
      )}
      {collForm && (
        <Modal onClose={() => setCollForm(null)}>
          <CollectionForm initial={collForm} items={items} ws={ws}
            onSave={(c) => saveCollection(c, collForm.id)}
            onDelete={collForm.id ? () => deleteCollection(collForm.id!) : undefined}
            onCancel={() => setCollForm(null)} />
        </Modal>
      )}
      {modal === 'blocktype' && (
        <Modal wide onClose={() => { setModal(null); setConvertFrom(null); }}>
          <BlockTypePicker from={convertFrom ? itemById(convertFrom) : null}
            onPick={(t) => startBlock(t, convertFrom)} />
        </Modal>
      )}
      {selected.length > 0 && page === 'library' && !openId && !block && (
        <div className="selbar" role="toolbar" aria-label="Selected files">
          <b>{selected.length} selected</b>
          <button className="primary" type="button" onClick={() => setShareTarget({ kind: 'assets', asset_ids: selected, title: `${selected.length} file${selected.length === 1 ? '' : 's'} from ${curWs?.name || 'us'}` })}><Icon.Share size={15} />Share</button>
          {folders.length > 0 && (
            <select className="in" value="" aria-label="Move to folder" onChange={async (e) => {
              const v = e.target.value; if (!v) return;
              const fid = v === 'none' ? null : v;
              const { error } = await supabase.from('assets').update({ folder_id: fid }).in('id', selected);
              if (error) { toast('Couldn’t move them.'); return; }
              setItems((list) => list.map((i) => (selected.includes(i.id) ? { ...i, folder_id: fid } : i)));
              toast(`Moved ${selected.length} file${selected.length === 1 ? '' : 's'}`); setSelected([]);
            }}>
              <option value="">Move to…</option>
              {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              <option value="none">No folder</option>
            </select>
          )}
          <button className="btn quiet" type="button" onClick={() => setSelected(visible.filter((i) => i.kind !== 'block').map((i) => i.id))}>Select all {visible.filter((i) => i.kind !== 'block').length}</button>
          <button className="btn quiet" type="button" onClick={() => setSelected([])}>Clear</button>
        </div>
      )}
      {shareTarget && curWs && (
        <>
          <div className="scrim top" onClick={() => setShareTarget(null)} />
          <div className="modal top" role="dialog" aria-modal="true">
            <button className="x" type="button" aria-label="Close" onClick={() => setShareTarget(null)}><Icon.Close /></button>
            <ShareDialog ws={curWs.id} target={shareTarget} toast={toast} onClose={() => setShareTarget(null)} onCreated={() => setSelected([])} />
          </div>
        </>
      )}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </div>
  );
}

// All files inside a dropped folder (and its subfolders).
async function readDir(dir: any): Promise<File[]> {
  const out: File[] = [];
  const walk = async (entry: any): Promise<void> => {
    if (entry.isFile) { out.push(await new Promise<File>((res, rej) => entry.file(res, rej))); return; }
    const reader = entry.createReader();
    for (;;) {
      const batch: any[] = await new Promise((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const b of batch) await walk(b);
    }
  };
  await walk(dir);
  return out;
}

// Editable copies, so the editor can change them freely until Save.
function blockDraft(b: Asset) {
  return { ...b, fields: { ...(b.fields || {}) }, images: JSON.parse(JSON.stringify(b.images || {})) };
}
function productDraft(p: Asset) {
  const pb = productAsBlock(p) as any;
  if (pb.images.image) pb.images.image.alt = p.fields?.alt || '';
  return { ...pb, id: p.id, kind: 'product', workspace_id: p.workspace_id, name: p.name, product_id: p.id };
}

// Copy a picture to the clipboard as a PNG: the way into Figma's desktop app, which doesn't take
// images dragged from Chrome. The PNG is made while the clipboard waits, so the click still counts.
export async function copyImageFrom(url: string) {
  const png = (async () => {
    const blob = await (await fetch(url)).blob();
    if (blob.type === 'image/png') return blob;
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas');
    cv.width = bmp.width; cv.height = bmp.height;
    cv.getContext('2d')!.drawImage(bmp, 0, 0);
    return await new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('export failed'))), 'image/png'));
  })();
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
}

function CopyBtn({ onCopy }: { onCopy?: () => void }) {
  if (!onCopy) return null;
  return (
    <button type="button" className="copyfig" title="Copy, then press ⌘V in Figma" onClick={(e) => { e.stopPropagation(); onCopy(); }} onKeyDown={(e) => e.stopPropagation()}>
      <Icon.Copy size={13} />Copy for Figma
    </button>
  );
}

// Unavailable files are greyed with their state; a licence ending within 30 days is flagged.
function tileClass(it: Asset) {
  return 'tile' + (!isAvailable(it) ? ' unavail' : expiresSoon(it) ? ' soon' : '');
}
function lifeLabel(it: Asset) {
  const l = lifecycleOf(it);
  if (l !== 'active') return LIFECYCLE[l].badge;
  if (expiresSoon(it)) return `Licence ends ${new Date(it.licence_expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
  return undefined;
}

function Tile({ it, src, urls, used = 0, onOpen, onCopy }: { it: Asset; src: string | null; urls: Record<string, string>; used?: number; onOpen: () => void; onCopy?: () => void }) {
  const usedLabel = used ? `In ${used} block${used > 1 ? 's' : ''}` : '';
  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } };
  if (it.kind === 'block') {
    const bt = BLOCK_TYPES[it.block_type] || { name: 'Block', fields: [] };
    return (
      <div className={tileClass(it)} data-life={lifeLabel(it)} role="button" tabIndex={0} title="Open block" onClick={onOpen} onKeyDown={onKey}>
        <div className="thumb block live">
          {bt.fields.length ? <FitPreview width={previewWidth(it)}><Preview b={it} bt={bt.fields} slotSrc={(s: any) => (s?.path ? urls[s.path] : undefined)} /></FitPreview> : <Wire type={it.block_type} />}
          <span className="tag">{bt.name}</span>
        </div>
        <div className="meta"><span className="t">{it.name}</span><span className="s">{it.figma?.node_id ? 'In Figma' : ''}</span></div>
      </div>
    );
  }
  // Products show as their photo, like the portal; the email card lives in the product editor.
  if (it.kind === 'product') {
    return (
      <div className={tileClass(it)} data-life={lifeLabel(it)} role="button" tabIndex={0} title="Click to open" onClick={onOpen} onKeyDown={onKey}>
        <div className="thumb product photo">
          {src ? <img src={src} alt={it.name} loading="lazy" draggable data-drag={it.pid || it.name} data-id={it.id} data-png={it.mime === 'image/png' ? '1' : '0'} />
            : <div className="noimg"><code>{it.pid}</code>Drop {it.pid}.jpg to add its image</div>}
          {src && <CopyBtn onCopy={onCopy} />}
        </div>
        <div className="meta"><span className="t">{it.name}</span><span className="s">{it.price || ''}</span></div>
      </div>
    );
  }
  if (it.kind === 'video') {
    const vsrc = it.storage_path ? urls[it.storage_path] : undefined;
    return (
      <div className={tileClass(it)} data-life={lifeLabel(it)} role="button" tabIndex={0} title="Open video" onClick={onOpen} onKeyDown={onKey}>
        <div className="thumb video" style={{ aspectRatio: '4 / 5' }}>
          {vsrc && <video src={vsrc} muted loop playsInline preload="metadata" onMouseEnter={(e) => e.currentTarget.play().catch(() => {})} onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }} />}
          <span className="tag vid">Video</span>
          {it.origin === 'generated' && <span className={'tag ' + (it.status === 'draft' ? 'draft' : 'ai')} style={{ left: 'auto', right: 8 }}>{it.status === 'draft' ? 'Draft · AI' : 'AI'}</span>}
        </div>
        <div className="meta"><span className="t">{it.name}</span><span className="s">{it.bytes ? `${(it.bytes / 1048576).toFixed(1)} MB` : ''}</span></div>
      </div>
    );
  }
  const right = usedLabel || (it.width ? `${it.width}×${it.height}` : '');
  return (
    <div className={tileClass(it)} data-life={lifeLabel(it)} role="button" tabIndex={0} title="Click to open" onClick={onOpen} onKeyDown={onKey}>
      <div className={'thumb ' + it.kind} style={it.kind === 'image' && it.width && it.height ? { aspectRatio: `${Math.max(0.5, Math.min(6, it.width / it.height))}` } : undefined}>
        {src ? (
          <img src={src} alt={it.name} loading="lazy" draggable data-drag={it.name} data-id={it.id} data-png={it.mime === 'image/png' ? '1' : '0'} />
        ) : it.storage_path ? null : (
          <div className="noimg"><code>{it.pid}</code>Drop {it.pid}.jpg to add its image</div>
        )}
        {src && !/svg/.test(it.mime || '') && <CopyBtn onCopy={onCopy} />}
        {it.status === 'draft' && <span className="tag draft">To review</span>}
        {(it.duplicate_of && !it.duplicate_ok && it.kind !== 'product') || it.on_brand === false ? (
          <span className="flags">
            {it.duplicate_of && !it.duplicate_ok && it.kind !== 'product' && <span className="tag dup" title="Looks like a copy of another file">Duplicate?</span>}
            {it.on_brand === false && <span className="tag offbrand" title={it.on_brand_reason || 'Doesn’t match the brand’s imagery rules'}>Off-brand</span>}
          </span>
        ) : null}
      </div>
      <div className="meta"><span className="t">{it.name}</span><span className="s">{right}</span></div>
    </div>
  );
}

