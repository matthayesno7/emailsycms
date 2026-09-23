'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { BLOCK_TYPES, KIND_LABEL, exportSize } from '@/lib/blockTypes';
import { baseName, dimsOf, drawFit, extOf, loadImg, parseCSV, toBlob } from '@/lib/images';
import { cardFromReading, readDesign } from '@/lib/extract';
import { cleanText, productAsBlock, shortDescription } from '@/lib/products';
import AssetPanel from './AssetPanel';
import BlockEditor, { FitPreview, Preview } from './BlockEditor';
import { Icon, Wire, ART } from './icons';
import { Modal, HelpFigma, HelpFeed, Members, Connector, BlockTypePicker, WorkspaceSettings } from './Modals';

export type Asset = Record<string, any> & { id: string; workspace_id: string; kind: string; name: string };
export type Ws = { id: string; name: string; role: string; figma_file_url?: string | null; figma_file_key?: string | null; figma_file_name?: string | null };
const WS_COLORS = ['#2f5bff', '#26313e', '#32a5db', '#e8a317', '#7b61ff', '#2f9e6e'];
const KINDS = ['image', 'logo', 'product', 'block'];

export default function Library({ userId, email, appUrl }: { userId: string; email: string; appUrl: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [workspaces, setWorkspaces] = useState<Ws[]>([]);
  const [ws, setWs] = useState<string>('');
  const [items, setItems] = useState<Asset[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);
  const [view, setView] = useState('all');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [block, setBlock] = useState<any>(null);
  const [modal, setModal] = useState<string | null>(null);
  const [convertFrom, setConvertFrom] = useState<string | null>(null);
  const [sideOpen, setSideOpen] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [newWs, setNewWs] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const toastT = useRef<any>(null);
  const fileImg = useRef<HTMLInputElement>(null);
  const fileCsv = useRef<HTMLInputElement>(null);
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

  useEffect(() => { loadWorkspaces(); }, [loadWorkspaces]);
  useEffect(() => {
    if (!ws) return;
    try { localStorage.setItem('emailsy.ws', ws); } catch {}
    setReady(false);
    loadAssets(ws);
    const ch = supabase
      .channel('assets-' + ws)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assets', filter: `workspace_id=eq.${ws}` }, () => loadAssets(ws))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [ws, supabase, loadAssets]);

  // Private bucket: sign every image path we need to show (valid for an hour).
  useEffect(() => {
    const paths = new Set<string>();
    for (const a of items) {
      if (a.storage_path) paths.add(a.storage_path);
      for (const s of Object.values(a.images || {}) as any[]) { if (s?.path) paths.add(s.path); if (s?.original_path) paths.add(s.original_path); }
    }
    const missing = [...paths].filter((p) => !urls[p]);
    if (!missing.length) return;
    supabase.storage.from('assets').createSignedUrls(missing, 3600).then(({ data }) => {
      if (!data) return;
      setUrls((u) => {
        const next = { ...u };
        for (const d of data) if (d.signedUrl && d.path) next[d.path] = d.signedUrl;
        return next;
      });
    });
  }, [items, urls, supabase]);

  const srcOf = useCallback((a?: Asset | null) => (a?.storage_path ? urls[a.storage_path] || null : null), [urls]);
  const itemById = useCallback((id?: string | null) => items.find((i) => i.id === id), [items]);
  const curWs = workspaces.find((w) => w.id === ws);
  const counts = useMemo(() => Object.fromEntries(['all', ...KINDS].map((k) => [k, k === 'all' ? items.length : items.filter((i) => i.kind === k).length])), [items]);
  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((it) => (view === 'all' || it.kind === view) && (!s || it.name.toLowerCase().includes(s) || (it.pid || '').toLowerCase().includes(s)));
  }, [items, view, q]);

  // ---------- writes ----------
  async function patchAsset(id: string, patch: Record<string, any>) {
    setItems((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    const { error } = await supabase.from('assets').update(patch).eq('id', id);
    if (error) { toast('Couldn’t save that change. Try again.'); loadAssets(ws); return false; }
    return true;
  }

  async function deleteAsset(a: Asset) {
    const paths: string[] = [];
    const referenced = (p: string) => items.some((o) => o.id !== a.id && Object.values(o.images || {}).some((s: any) => s?.original_path === p || s?.path === p));
    if (a.storage_path && !referenced(a.storage_path)) paths.push(a.storage_path);
    for (const s of Object.values(a.images || {}) as any[]) if (s?.path && !referenced(s.path)) paths.push(s.path);
    const { error } = await supabase.from('assets').delete().eq('id', a.id);
    if (error) { toast('Couldn’t delete. Try again.'); return; }
    if (paths.length) await supabase.storage.from('assets').remove(paths);
    setItems((list) => list.filter((i) => i.id !== a.id));
    setOpenId(null); setBlock(null);
    toast('Deleted');
  }

  async function uploadImage(file: File) {
    const ext = extOf(file);
    const type = file.type || (ext === 'svg' ? 'image/svg+xml' : ext === 'png' ? 'image/png' : 'image/jpeg');
    const path = `${ws}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from('assets').upload(path, file, { contentType: type, upsert: false });
    if (error) { toast(/size|large/i.test(error.message) ? `${file.name} is over 25 MB.` : `Couldn’t upload ${file.name}.`); return; }
    const { w, h } = await dimsOf(file);
    const base = baseName(file.name || 'Pasted image');
    const prod = items.find((i) => i.kind === 'product' && i.pid === base);
    if (prod) {
      await patchAsset(prod.id, { storage_path: path, mime: type, width: w, height: h, bytes: file.size });
      toast(`Attached to ${prod.name}`);
      return;
    }
    const kind = /logo|wordmark|brandmark/i.test(base) || type === 'image/svg+xml' ? 'logo' : 'image';
    const { error: e2 } = await supabase.from('assets').insert({
      workspace_id: ws, kind, name: base.replace(/[-_]+/g, ' ').slice(0, 120) || 'Image', storage_path: path, mime: type,
      width: w, height: h, bytes: file.size, created_by: userId,
    });
    if (e2) toast('Couldn’t save the image.');
  }

  async function importFeed(file: File) {
    const rows = parseCSV(await file.text());
    if (rows.length < 2) { toast('That CSV has no product rows.'); return; }
    const head = rows[0].map((h) => h.trim().toLowerCase().replace(/^g:/, ''));
    const col = (...n: string[]) => head.findIndex((h) => n.includes(h));
    const ci = {
      pid: col('id', 'pid', 'sku', 'item_id', 'product_id'), name: col('title', 'name', 'product_name'), price: col('sale_price', 'price'),
      link: col('link', 'url', 'product_url'), img: col('image_link', 'image', 'image_url'), desc: col('description', 'short_description', 'body_html', 'body'),
    };
    if (ci.pid < 0) { toast('Couldn’t find a PID column (id, pid, sku or item_id).'); return; }
    // Existing products: copy the team edited (name, description) is kept; price, link and image follow the feed.
    const { data: existing } = await supabase.from('assets').select('id, pid, name, fields, feed_image, storage_path, created_by').eq('workspace_id', ws).eq('kind', 'product').limit(10000);
    const byPid = new Map((existing || []).map((e: any) => [e.pid, e]));
    const seen = new Set<string>();
    const products = rows.slice(1).map((r) => {
      const pid = (r[ci.pid] || '').trim();
      if (!pid || seen.has(pid)) return null;
      seen.add(pid);
      const ex: any = byPid.get(pid);
      const edited: string[] = ex?.fields?.edited || [];
      const feedName = ((ci.name >= 0 && r[ci.name]) || pid).trim().slice(0, 120);
      const feedImage = ci.img >= 0 ? (r[ci.img] || '').trim() : '';
      const fields: Record<string, any> = { ...(ex?.fields || {}) };
      if (ci.desc >= 0) {
        fields.feed_description = cleanText(r[ci.desc] || '').slice(0, 5000);
        if (!edited.includes('description')) fields.description = shortDescription(r[ci.desc] || '');
      }
      const imageChanged = !!ex && !!feedImage && ex.feed_image !== feedImage;
      return {
        workspace_id: ws, kind: 'product', pid,
        name: edited.includes('name') && ex ? ex.name : feedName,
        price: ci.price >= 0 ? (r[ci.price] || '').trim() : null, link: ci.link >= 0 ? (r[ci.link] || '').trim() : null,
        feed_image: feedImage || null, fields,
        storage_path: imageChanged ? null : ex?.storage_path ?? null,
        created_by: ex?.created_by || userId,
      };
    }).filter(Boolean) as any[];
    toast(`Importing ${products.length} products…`);
    for (let i = 0; i < products.length; i += 200) {
      const { error } = await supabase.from('assets').upsert(products.slice(i, i + 200), { onConflict: 'workspace_id,pid' });
      if (error) { toast(`Import stopped: ${error.message}`); return; }
    }
    setView('product');
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
      if (!json.remaining || (!json.done && !(json.failed || []).length)) break;
      toast(`Fetched ${done} product images…`);
    }
    toast(failed ? `${done} product images added. ${failed} couldn’t be downloaded; drop PID.jpg files to add them.` : `${done} product images added`);
  }

  async function ingest(files: FileList | File[]) {
    const list = [...files];
    if (!list.length || !ws) return;
    for (const f of list.filter((f) => /\.csv$/i.test(f.name) || f.type === 'text/csv')) await importFeed(f);
    const imgs = list.filter((f) => /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|svg)$/i.test(f.name));
    // In Blocks, images become blocks: ask for the block type, then create them.
    if (view === 'block' && imgs.length) { setPendingFiles(imgs); setConvertFrom(null); setModal('blocktype'); return; }
    if (imgs.length > 1) toast(`Adding ${imgs.length} images…`);
    for (const f of imgs) await uploadImage(f);
    if (imgs.length) loadAssets(ws);
  }

  async function createWorkspace(name: string) {
    const { data, error } = await supabase.rpc('create_workspace', { ws_name: name });
    if (error || !data) { toast('Couldn’t create the workspace.'); return; }
    await loadWorkspaces((data as any).id);
    setView('all');
    toast(`${name} workspace created`);
  }

  // ---------- block flows ----------
  async function uploadOriginal(file: File) {
    const ext = extOf(file);
    const mime = file.type || (ext === 'png' ? 'image/png' : ext === 'svg' ? 'image/svg+xml' : 'image/jpeg');
    const original = `${ws}/${crypto.randomUUID()}.${ext}`;
    const up = await supabase.storage.from('assets').upload(original, file, { contentType: mime });
    if (up.error) throw up.error;
    const local = URL.createObjectURL(file);
    let img: HTMLImageElement;
    try { img = await loadImg(local); } finally { URL.revokeObjectURL(local); }
    const name = baseName(file.name || 'Image').replace(/[-_]+/g, ' ').slice(0, 120);
    return { original, img, name };
  }

  // Render the email-ready crop for the block's image slot and save the block.
  async function blockFromImage(img: HTMLImageElement, original: string, type: string, name: string) {
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
      workspace_id: ws, kind: 'block', block_type: type, name: name || `${bt.name} block`, fields: {}, created_by: userId,
      images: { [d.k]: { path, width: w, height: h, format: d.png ? 'png' : 'jpg', bytes: blob.size, alt: name, original_path: original } },
    }).select('*').single();
    if (error) throw error;
    return data as Asset;
  }

  // A finished design: Emailsy reads it and saves an editable Card. Falls back to a Design block.
  async function blockFromDesign(img: HTMLImageElement, original: string, name: string): Promise<{ row: Asset; note?: string }> {
    const r = await readDesign(img, ws);
    if (!r.ok) {
      const row = await blockFromImage(img, original, 'design', name);
      const note = r.reason === 'not_configured'
        ? 'Saved as a Design block. Add an Anthropic API key to let Emailsy read designs.'
        : r.reason === 'not_a_design'
        ? 'No copy found in that image, so it was saved as a Design block.'
        : `Couldn’t read the design${r.message ? ` (${r.message})` : ''}. Saved as a Design block.`;
      return { row, note };
    }
    const built = await cardFromReading({ supabase, ws, img, originalPath: original, reading: r.reading, crop: r.crop });
    const { data, error } = await supabase.from('assets').insert({
      workspace_id: ws, kind: 'block', name: (r.reading.headline || name || 'Card block').slice(0, 120), created_by: userId, ...built,
    }).select('*').single();
    if (error) throw error;
    return { row: data as Asset };
  }

  async function blocksFromFiles(type: string) {
    const files = pendingFiles;
    setPendingFiles([]); setModal(null);
    if (!files.length) return;
    const design = type === 'design';
    toast(design ? (files.length > 1 ? `Reading ${files.length} designs…` : 'Reading your design…') : files.length > 1 ? `Making ${files.length} blocks…` : 'Making your block…');
    const made: Asset[] = [];
    let note: string | undefined;
    for (const f of files) {
      try {
        const { original, img, name } = await uploadOriginal(f);
        if (design) { const r = await blockFromDesign(img, original, name); made.push(r.row); note = note || r.note; }
        else made.push(await blockFromImage(img, original, type, name));
      } catch { toast(`Couldn’t make a block from ${f.name}.`); }
    }
    if (!made.length) return;
    setItems((list) => [...made, ...list]);
    setView('block');
    if (made.length === 1) {
      const b = made[0];
      setBlock({ ...b, fields: { ...(b.fields || {}) }, images: JSON.parse(JSON.stringify(b.images || {})) });
      toast(note || (design ? 'Design read and saved as a Card. Check the copy.' : 'Block created. Add your copy.'));
    } else toast(note || `${made.length} blocks created`);
  }

  function startBlock(type: string, fromId?: string | null) {
    const bt = BLOCK_TYPES[type];
    const conv = fromId ? itemById(fromId) : null;
    const draft: any = { kind: 'block', block_type: type, name: `${bt.name} block`, fields: {}, images: {} };
    if (conv) {
      const slot = bt.fields.find((d) => d.type === 'image')!;
      draft.name = conv.name;
      draft.convertFrom = conv.id;
      draft.images[slot.k] = { source_asset_id: conv.id, alt: conv.name, dirty: true, original_path: conv.storage_path };
      if (conv.kind === 'product') { draft.product_id = conv.id; Object.assign(draft.fields, { name: conv.name, price: conv.price || '', link: conv.link || '' }); }
    }
    setModal(null); setConvertFrom(null); setOpenId(null);
    setBlock(draft);
  }

  // ---------- global events ----------
  useEffect(() => {
    const hasFiles = (e: DragEvent) => !internalDrag.current && [...(e.dataTransfer?.types || [])].includes('Files');
    const enter = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); dragN.current++; setDropping(true); };
    const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const leave = (e: DragEvent) => { if (!hasFiles(e)) return; if (--dragN.current <= 0) { dragN.current = 0; setDropping(false); } };
    const drop = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); dragN.current = 0; setDropping(false); ingest(e.dataTransfer!.files); };
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
        e.dataTransfer!.effectAllowed = 'copy';
      } catch {}
    };
    const end = () => { internalDrag.current = false; };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpenId(null); setBlock(null); setModal(null); setSideOpen(false); }
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement as HTMLElement)?.tagName)) { e.preventDefault(); searchRef.current?.focus(); }
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

  const nav = (v: string) => { setView(v); setSideOpen(false); };
  const openAsset = openId ? itemById(openId) : null;

  // ---------- render ----------
  return (
    <div className="app">
      <aside className={'side' + (sideOpen ? ' open' : '')} aria-label="Navigation">
        <div className="org"><span className="logo"><Icon.Mark /></span>Emailsy <span className="plan">CMS</span></div>
        <button className="nav" type="button" aria-current={view === 'all'} onClick={() => nav('all')}><Icon.Home />Home<span className="count">{counts.all || ''}</span></button>
        <button className="nav" type="button" onClick={() => { setSideOpen(false); searchRef.current?.focus(); }}><Icon.Search />Search</button>
        <div className="group">Library</div>
        {KINDS.map((k) => (
          <button key={k} className="nav" type="button" aria-current={view === k} onClick={() => nav(k)}>
            {k === 'image' ? <Icon.Image /> : k === 'logo' ? <Icon.Shield /> : k === 'product' ? <Icon.Tag /> : <Icon.Blocks />}
            {KIND_LABEL[k]}<span className="count">{counts[k] || ''}</span>
          </button>
        ))}
        <div className="group">Workspaces</div>
        {workspaces.map((w, i) => (
          <button key={w.id} className="nav ws" type="button" aria-current={w.id === ws} onClick={() => { setWs(w.id); nav('all'); }}>
            <span className="dot" style={{ background: WS_COLORS[i % WS_COLORS.length] }}>{(w.name[0] || '?').toUpperCase()}</span>{w.name}
          </button>
        ))}
        {newWs === null ? (
          <button className="nav muted" type="button" onClick={() => setNewWs('')}><Icon.Plus />New workspace</button>
        ) : (
          <form className="newws" onSubmit={(e) => { e.preventDefault(); const n = newWs.trim(); if (n) createWorkspace(n); setNewWs(null); }}>
            <input className="in" autoFocus value={newWs} maxLength={40} placeholder="Brand name" onChange={(e) => setNewWs(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setNewWs(null)} />
            <button className="btn" type="submit">Add</button>
          </form>
        )}
        <div className="group">Team &amp; Claude</div>
        <button className="nav" type="button" onClick={() => { setSideOpen(false); setModal('settings'); }}><Icon.Settings />Workspace settings{!curWs?.figma_file_key && <span className="count dotnote" title="No Figma file connected">•</span>}</button>
        <button className="nav" type="button" onClick={() => { setSideOpen(false); setModal('members'); }}><Icon.Users />Members</button>
        <button className="nav" type="button" onClick={() => { setSideOpen(false); setModal('connector'); }}><Icon.Plug />Claude connector</button>
        <div className="group">Help</div>
        <button className="nav" type="button" onClick={() => { setSideOpen(false); setModal('help-figma'); }}><Icon.Send />Using assets in Figma</button>
        <button className="nav" type="button" onClick={() => { setSideOpen(false); setModal('help-feed'); }}><Icon.Table />Product feed format</button>
        <div className="me"><span title={email}>{email}</span><button type="button" onClick={async () => { await supabase.auth.signOut(); location.href = '/login'; }}>Sign out</button></div>
      </aside>

      <main>
        <div className="bar">
          <button className="menu" type="button" aria-label="Open navigation" onClick={() => setSideOpen(true)}><Icon.Menu /></button>
          <div className="crumb">{curWs?.name || '…'}<Icon.Chevron /><b>{KIND_LABEL[view]}</b></div>
          <div className="spacer" />
          <label className="search" htmlFor="q"><Icon.Search size={15} /><input id="q" ref={searchRef} type="search" placeholder="Search name or PID" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <button className="ghost" type="button" onClick={() => fileCsv.current?.click()}><Icon.Download /><span className="lbl">Import feed</span></button>
          <button className="primary" type="button" onClick={() => fileImg.current?.click()}><Icon.Plus size={16} /><span className="lbl">Upload</span></button>
        </div>

        <div className="content">
          {!ready ? (
            <p className="loading">Loading your library…</p>
          ) : !items.length ? (
            <div className="empty">
              <div dangerouslySetInnerHTML={{ __html: ART }} />
              <h2>No assets yet</h2>
              <p>Drop images, logos or a product feed anywhere on this page, then size them for email and drag them into Figma.</p>
              <div className="row">
                <button className="primary" type="button" onClick={() => fileImg.current?.click()}><Icon.Plus size={16} />Upload assets</button>
                <button className="ghost" type="button" onClick={() => fileCsv.current?.click()}>Import a product feed</button>
              </div>
            </div>
          ) : (
            <>
              <div className="head">
                <h1>{KIND_LABEL[view]}</h1><span className="n">{visible.length}</span>
                {view === 'block' && (<><span className="spacer" /><button className="primary" type="button" onClick={() => setModal('blocktype')}><Icon.Plus size={16} />New block</button></>)}
              </div>
              {!visible.length ? (
                view === 'block' && !q ? (
                  <div className="empty small">
                    <Wire type="hero" />
                    <h2>No blocks yet</h2>
                    <p>A block is ready-to-use email content: images and copy together. Drop images here to start blocks from them, or create one from scratch.</p>
                    <div className="row">
                      <button className="primary" type="button" onClick={() => fileImg.current?.click()}><Icon.Plus size={16} />Upload images</button>
                      <button className="ghost" type="button" onClick={() => setModal('blocktype')}>Create a block</button>
                    </div>
                  </div>
                ) : (
                  <p className="nomatch">{q ? `Nothing matches “${q}”.` : `No ${KIND_LABEL[view].toLowerCase()} in ${curWs?.name} yet. Drop some onto the page.`}</p>
                )
              ) : (
                <div className="grid">
                  {visible.map((it) => <Tile key={it.id} it={it} src={srcOf(it)} urls={urls} onOpen={() => (it.kind === 'block' ? setBlock({ ...it, images: JSON.parse(JSON.stringify(it.images || {})), fields: { ...(it.fields || {}) } }) : setOpenId(it.id))} />)}
                </div>
              )}
            </>
          )}
        </div>
      </main>

      <input ref={fileImg} type="file" multiple accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.csv,text/csv" hidden onChange={(e) => { if (e.target.files) ingest(e.target.files); e.target.value = ''; }} />
      <input ref={fileCsv} type="file" accept=".csv,text/csv" hidden onChange={(e) => { if (e.target.files) ingest(e.target.files); e.target.value = ''; }} />
      {dropping && <div className="drop"><div><strong>{view === 'block' ? 'Drop to make blocks' : 'Drop to add'}</strong><span>{view === 'block' ? 'Each image becomes a block. You pick the type next.' : 'Images, logos, or a product feed CSV'}</span></div></div>}
      {(openAsset || block || modal || sideOpen) && <div className="scrim" onClick={() => { setOpenId(null); setBlock(null); setModal(null); setSideOpen(false); }} />}

      {openAsset && (
        <AssetPanel
          key={openAsset.id}
          it={openAsset}
          src={srcOf(openAsset)}
          onClose={() => setOpenId(null)}
          onPatch={(p) => patchAsset(openAsset.id, p)}
          onDelete={() => deleteAsset(openAsset)}
          onMakeBlock={() => { setConvertFrom(openAsset.id); setOpenId(null); setModal('blocktype'); }}
          toast={toast}
        />
      )}

      {block && (
        <BlockEditor
          key={block.id || 'new'}
          draft={block}
          ws={ws}
          userId={userId}
          library={items}
          urls={urls}
          appUrl={appUrl}
          figmaFile={curWs?.figma_file_key ? { url: curWs.figma_file_url || '', name: curWs.figma_file_name || '' } : null}
          supabase={supabase}
          toast={toast}
          onClose={() => setBlock(null)}
          onSaved={(row, convertedFrom) => {
            setItems((list) => [row, ...list.filter((i) => i.id !== row.id && i.id !== convertedFrom)]);
            setView('block');
          }}
          onDelete={(b) => deleteAsset(b)}
        />
      )}

      {modal === 'blocktype' && (
        <Modal wide onClose={() => { setModal(null); setConvertFrom(null); setPendingFiles([]); }}>
          <BlockTypePicker from={convertFrom ? itemById(convertFrom) : null} count={pendingFiles.length}
            onPick={(t) => (pendingFiles.length ? blocksFromFiles(t) : startBlock(t, convertFrom))} />
        </Modal>
      )}
      {modal === 'help-figma' && <Modal onClose={() => setModal(null)}><HelpFigma /></Modal>}
      {modal === 'help-feed' && <Modal onClose={() => setModal(null)}><HelpFeed /></Modal>}
      {modal === 'members' && curWs && <Modal onClose={() => setModal(null)}><Members supabase={supabase} ws={curWs} userId={userId} toast={toast} /></Modal>}
      {modal === 'connector' && <Modal onClose={() => setModal(null)}><Connector supabase={supabase} toast={toast} /></Modal>}
      {modal === 'settings' && curWs && (
        <Modal onClose={() => setModal(null)}>
          <WorkspaceSettings supabase={supabase} ws={curWs} toast={toast} onSaved={() => loadWorkspaces(curWs.id)} />
        </Modal>
      )}
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </div>
  );
}

function Tile({ it, src, urls, onOpen }: { it: Asset; src: string | null; urls: Record<string, string>; onOpen: () => void }) {
  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } };
  if (it.kind === 'block') {
    const bt = BLOCK_TYPES[it.block_type] || { name: 'Block', fields: [] };
    return (
      <div className="tile" role="button" tabIndex={0} title="Open block" onClick={onOpen} onKeyDown={onKey}>
        <div className="thumb block live">
          {bt.fields.length ? <FitPreview><Preview b={it} bt={bt.fields} slotSrc={(s: any) => (s?.path ? urls[s.path] : undefined)} /></FitPreview> : <Wire type={it.block_type} />}
          <span className="tag">{bt.name}</span>
        </div>
        <div className="meta"><span className="t">{it.name}</span><span className="s">{it.figma?.node_id ? 'In Figma' : ''}</span></div>
      </div>
    );
  }
  if (it.kind === 'product') {
    const pb = productAsBlock(it);
    return (
      <div className="tile" role="button" tabIndex={0} title="Click to open · drag the image into Figma" onClick={onOpen} onKeyDown={onKey}>
        <div className="thumb block live product">
          <FitPreview><Preview b={pb} bt={BLOCK_TYPES.product.fields} slotSrc={(s: any) => (s?.path ? urls[s.path] : undefined)} drag={{ name: it.pid || it.name, png: it.mime === 'image/png' }} /></FitPreview>
          {!it.storage_path && <span className="tag noimgtag">No image</span>}
        </div>
        <div className="meta"><span className="t">{it.name}</span><span className="s">{it.pid || ''}</span></div>
      </div>
    );
  }
  const right = it.width ? `${it.width}×${it.height}` : '';
  return (
    <div className="tile" role="button" tabIndex={0} title="Click to open · drag into Figma" onClick={onOpen} onKeyDown={onKey}>
      <div className={'thumb ' + it.kind}>
        {src ? (
          <img src={src} alt={it.name} loading="lazy" draggable data-drag={it.name} data-png={it.mime === 'image/png' ? '1' : '0'} />
        ) : it.storage_path ? null : (
          <div className="noimg"><code>{it.pid}</code>Drop {it.pid}.jpg to add its image</div>
        )}
        {src && <span className="drag">Drag to Figma</span>}
      </div>
      <div className="meta"><span className="t">{it.name}</span><span className="s">{right}</span></div>
    </div>
  );
}

