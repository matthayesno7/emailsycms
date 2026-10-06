// Reading product rows from a CSV/TSV feed (Shopify export, Google Merchant, a Google Sheet).
// Pure, so the browser's CSV import and the server's synced feeds read columns the same way.
export type FeedProduct = { pid: string; name: string; price: string | null; link: string | null; image: string | null; desc: string | null };

export function fromRows(rows: string[][]): FeedProduct[] | { error: string } {
  if (rows.length < 2) return { error: 'The feed has no product rows.' };
  const head = rows[0].map((h) => h.trim().toLowerCase().replace(/^g:/, ''));
  const col = (...n: string[]) => head.findIndex((h) => n.includes(h));
  const ci = {
    pid: col('id', 'pid', 'sku', 'item_id', 'product_id', 'handle'), name: col('title', 'name', 'product_name'), price: col('price', 'variant price'), sale: col('sale_price'),
    link: col('link', 'url', 'product_url'), img: col('image_link', 'image', 'image_url', 'image src'), desc: col('description', 'short_description', 'body_html', 'body', 'body (html)'),
  };
  if (ci.pid < 0) return { error: 'Couldn’t find a product ID column (id, pid, sku or item_id).' };
  const v = (r: string[], i: number) => (i >= 0 ? (r[i] || '').trim() : '');
  return rows.slice(1).map((r) => ({ pid: v(r, ci.pid), name: v(r, ci.name), price: v(r, ci.sale) || v(r, ci.price) || null, link: v(r, ci.link) || null, image: v(r, ci.img) || null, desc: v(r, ci.desc) || null })).filter((p) => p.pid);
}

