// Product feeds that stay in sync: a feed link (Google Merchant XML, or any CSV/TSV, e.g. a published
// Google Sheet) or a Shopify store (its public product list). Server only.
// Each sync adds and updates products, marks ones that left the feed as no longer available, and
// fetches new images in the background. Pro brands sync daily (startFeedWorker); anyone can sync by hand.
import { parseCSV } from './csv';
import { fromRows, type FeedProduct } from './feedParse';
export type { FeedProduct };
import { cleanText, shortDescription } from './products';
import { fetchLimited } from './net';
import { feedImageBatch } from './feedImages';
import { planOf } from './billing';
import { createAdminClient } from './supabase/admin';

export type Feed = { id: string; workspace_id: string; kind: 'url' | 'shopify'; source: string; name: string | null; created_by: string | null };

const MAX_PRODUCTS = 10_000;
const REMOVED = 'No longer in the product feed';

// ---------- reading feeds ----------
const decode = (s: string) => s
  .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&').trim();

function fromXml(text: string): FeedProduct[] {
  const items = text.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  return items.map((it) => {
    const tag = (n: string) => { const m = it.match(new RegExp(`<(?:g:)?${n}\\b[^>]*>([\\s\\S]*?)</(?:g:)?${n}>`, 'i')); return m ? decode(m[1]) : ''; };
    const href = it.match(/<link\b[^>]*href="([^"]+)"/i)?.[1];
    return { pid: tag('id'), name: tag('title'), price: tag('sale_price') || tag('price') || null, link: tag('link') || (href ? decode(href) : null), image: tag('image_link') || null, desc: tag('description') || null } as FeedProduct;
  }).filter((p) => p.pid);
}

async function readUrl(url: string): Promise<FeedProduct[] | { error: string }> {
  const got = await fetchLimited(url, { accept: 'application/xml,text/xml,text/csv,text/plain,*/*', maxBytes: 60 * 1024 * 1024, timeoutMs: 45_000 });
  if ('error' in got) return { error: got.error === 'Not a public web address' ? 'That isn’t a public web address.' : `Couldn’t download the feed (${got.error}).` };
  const text = got.buf.toString('utf8');
  if (/^\s*</.test(text) && /<(rss|feed|channel|item)\b/i.test(text.slice(0, 5000))) {
    const items = fromXml(text);
    return items.length ? items : { error: 'The feed has no products in it.' };
  }
  if (/^\s*</.test(text)) return { error: 'That link opens a web page, not a feed. Use the feed’s own link (Google Merchant: Feeds → your feed → Settings).' };
  return fromRows(parseCSV(text));
}

// "https://www.shop.com/collections/x" → "www.shop.com"
export function storeHost(input: string) {
  const s = String(input || '').trim().replace(/^https?:\/\//i, '').replace(/[/?#].*$/, '').toLowerCase();
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) ? s : null;
}

async function readShopify(host: string): Promise<FeedProduct[] | { error: string }> {
  const out: FeedProduct[] = [];
  for (let page = 1; page <= 40 && out.length < MAX_PRODUCTS; page++) {
    const got = await fetchLimited(`https://${host}/products.json?limit=250&page=${page}`, { accept: 'application/json', maxBytes: 25 * 1024 * 1024, timeoutMs: 30_000 });
    if ('error' in got) {
      if (page === 1) return { error: /404|403|401/.test(got.error) ? `That doesn’t look like a Shopify store, or its product list is switched off (${host}/products.json).` : `Couldn’t reach ${host} (${got.error}).` };
      break;
    }
    let j: any = null;
    try { j = JSON.parse(got.buf.toString('utf8')); } catch {}
    if (!Array.isArray(j?.products)) { if (page === 1) return { error: `That doesn’t look like a Shopify store (${host}).` }; break; }
    if (!j.products.length) break;
    const base = new URL(got.url).host;
    for (const p of j.products) {
      const v = p.variants?.[0];
      out.push({ pid: String(p.handle || p.id), name: String(p.title || p.handle || p.id), price: v?.price ?? null, link: p.handle ? `https://${base}/products/${p.handle}` : null, image: p.images?.[0]?.src || null, desc: p.body_html || null });
    }
    if (j.products.length < 250) break;
  }
  return out.length ? out : { error: `${host} has no published products.` };
}

export async function readFeed(kind: Feed['kind'], source: string) {
  return kind === 'shopify' ? readShopify(source) : readUrl(source);
}

// ---------- applying a feed to the library ----------
// The team's own edits to a name or description are kept; price, link and image follow the feed.
export async function applyProducts(db: any, ws: string, userId: string | null, feedId: string, list: FeedProduct[]) {
  const seen = new Set<string>();
  const products = list.filter((p) => p.pid && !seen.has(p.pid) && seen.add(p.pid)).slice(0, MAX_PRODUCTS);
  const existing: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('assets').select('id, pid, name, fields, feed_image, storage_path, created_by, lifecycle, lifecycle_reason').eq('workspace_id', ws).eq('kind', 'product').range(from, from + 999);
    if (error) throw new Error(error.message);
    existing.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const byPid = new Map(existing.map((e) => [e.pid, e]));
  let added = 0, updated = 0;
  const rows = products.map((p) => {
    const ex: any = byPid.get(p.pid);
    if (ex) updated++; else added++;
    const edited: string[] = ex?.fields?.edited || [];
    const fields: Record<string, any> = { ...(ex?.fields || {}), feed_id: feedId };
    if (p.desc) {
      fields.feed_description = cleanText(p.desc).slice(0, 5000);
      if (!edited.includes('description')) fields.description = shortDescription(p.desc);
    }
    const image = p.image || null;
    const imageChanged = !!ex && !!image && ex.feed_image !== image;
    return {
      workspace_id: ws, kind: 'product', origin: 'product_feed', pid: p.pid.slice(0, 120),
      name: edited.includes('name') && ex ? ex.name : (p.name || p.pid).slice(0, 120),
      price: p.price, link: p.link, feed_image: image, fields,
      storage_path: imageChanged ? null : ex?.storage_path ?? null,
      created_by: ex?.created_by || userId,
    };
  });
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from('assets').upsert(rows.slice(i, i + 200), { onConflict: 'workspace_id,pid' });
    if (error) throw new Error(error.message);
  }
  // Back in the feed: available again (only if the feed was what took it away).
  const back = existing.filter((e) => seen.has(e.pid) && e.lifecycle === 'archived' && e.lifecycle_reason === REMOVED).map((e) => e.id);
  for (let i = 0; i < back.length; i += 200) await db.from('assets').update({ lifecycle: 'active', lifecycle_reason: null, lifecycle_at: new Date().toISOString() }).in('id', back.slice(i, i + 200));
  // Gone from this feed: no longer available (kept, so past work still makes sense). Skipped if the
  // feed suddenly lost more than half its products, which is more likely a glitch than a clear-out.
  const fromThisFeed = existing.filter((e) => e.fields?.feed_id === feedId && (e.lifecycle || 'active') === 'active');
  const gone = fromThisFeed.filter((e) => !seen.has(e.pid)).map((e) => e.id);
  let removed = 0;
  if (gone.length && products.length >= fromThisFeed.length / 2) {
    for (let i = 0; i < gone.length; i += 200) await db.from('assets').update({ lifecycle: 'archived', lifecycle_reason: REMOVED, lifecycle_at: new Date().toISOString() }).in('id', gone.slice(i, i + 200));
    removed = gone.length;
  }
  return { count: products.length, added, updated, removed, restored: back.length, images: rows.filter((r) => r.feed_image && !r.storage_path).length };
}

// New and changed images, fetched in the background (up to ~10 minutes a run).
export function fetchImagesInBackground(db: any, ws: string) {
  (async () => {
    const skip: string[] = [];
    const until = Date.now() + 10 * 60_000;
    while (Date.now() < until) {
      const r = await feedImageBatch(db, ws, skip);
      if ('error' in r) { console.error('[feeds] images', r.error); return; }
      for (const f of r.failed) skip.push(f.id);
      if (r.limit || !r.remaining) return;
    }
  })().catch((e) => console.error('[feeds] images', e?.message));
}

export async function syncFeed(db: any, feed: Feed, already?: FeedProduct[]) {
  const read = already || (await readFeed(feed.kind, feed.source));
  const at = new Date().toISOString();
  if ('error' in read) {
    await db.from('product_feeds').update({ last_synced_at: at, last_status: read.error }).eq('id', feed.id);
    return { error: read.error };
  }
  try {
    const r = await applyProducts(db, feed.workspace_id, feed.created_by, feed.id, read);
    await db.from('product_feeds').update({ last_synced_at: at, last_status: 'ok', last_count: r.count }).eq('id', feed.id);
    if (r.images) fetchImagesInBackground(db, feed.workspace_id);
    return r;
  } catch (e: any) {
    const msg = `Couldn’t save the products (${e?.message || 'error'}).`;
    await db.from('product_feeds').update({ last_synced_at: at, last_status: msg }).eq('id', feed.id);
    return { error: msg };
  }
}

// ---------- daily sync on Pro ----------
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
export async function runDueFeeds() {
  if (running || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  running = true;
  try {
    const db = createAdminClient();
    const due = new Date(Date.now() - 23 * 3600_000).toISOString();
    const { data } = await db.from('product_feeds').select('*').or(`last_synced_at.is.null,last_synced_at.lt.${due}`).order('last_synced_at', { ascending: true, nullsFirst: true }).limit(300);
    let n = 0;
    for (const f of (data || []) as Feed[]) {
      if (n >= 10) break;
      if ((await planOf(db, f.workspace_id)).plan === 'free') continue;
      n++;
      const r = await syncFeed(db, f);
      console.log('[feeds] synced', f.id, 'error' in r ? r.error : `${r.count} products`);
    }
  } finally {
    running = false;
  }
}
export function startFeedWorker(everyMs = 30 * 60_000) {
  if (timer || !process.env.SUPABASE_SERVICE_ROLE_KEY) return;
  timer = setInterval(() => { runDueFeeds().catch((e) => console.error('[feeds]', e)); }, everyMs);
  (timer as any).unref?.();
}
