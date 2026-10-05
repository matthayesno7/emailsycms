// The review queue: what Mise did on its own that needs a person, and what it did for you.
// Pure (no database): the app and the Claude connector both build it from the brand's assets
// and brand kit, so they always agree on what's waiting.

type A = Record<string, any> & { id: string; kind: string; name: string };
type Kit = { status?: string | null } | null | undefined;

export type ReviewKind = 'draft' | 'duplicate' | 'off_brand' | 'failed' | 'no_image' | 'brand_kit';
export type ReviewAction = 'approve' | 'reject' | 'keep_both' | 'delete' | 'fine' | 'retry' | 'open' | 'open_products' | 'open_brand_kit';

export type ReviewItem = {
  key: string;          // stable id for this item (kind + asset id)
  kind: ReviewKind;
  asset_id?: string;
  other_id?: string;    // the file it looks like a copy of
  asset_ids?: string[]; // grouped items (products without a photo)
  title: string;
  detail: string;
  actions: ReviewAction[];
};

export const SECTION: Record<ReviewKind, { title: string; hint: string }> = {
  draft: { title: 'Waiting for approval', hint: 'Made with Claude or Create. Approve to use them; reject to bin them.' },
  duplicate: { title: 'Possible duplicates', hint: 'These look like copies of files you already have.' },
  off_brand: { title: 'Off-brand', hint: 'They don’t match your brand kit’s imagery rules.' },
  failed: { title: 'Couldn’t organise', hint: 'Mise couldn’t read these, so they have no tags or alt text yet.' },
  no_image: { title: 'Products without a photo', hint: 'Drop a photo named after the product’s ID onto the library.' },
  brand_kit: { title: 'Brand kit', hint: 'Everything Mise makes and checks follows it.' },
};
export const ORDER: ReviewKind[] = ['draft', 'duplicate', 'off_brand', 'failed', 'no_image', 'brand_kit'];

const short = (s: unknown, n = 140) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const madeBy = (a: A) => (a.provenance?.via === 'studio' ? 'Made in Create' : /figma/i.test(a.provenance?.model || '') || a.figma?.file_key ? 'Made in Figma' : a.provenance?.model ? `Made with ${a.provenance.model}` : 'Made with Claude');

export function reviewQueue(assets: A[], kit: Kit, now = Date.now()) {
  const files = assets.filter((a) => a.kind !== 'block');
  const byId = new Map(files.map((a) => [a.id, a]));
  const items: ReviewItem[] = [];
  for (const a of files) {
    if (a.status === 'draft') {
      const bits = [madeBy(a), a.provenance?.prompt && `“${short(a.provenance.prompt, 110)}”`, a.on_brand === false && `Off-brand: ${short(a.on_brand_reason, 80) || 'doesn’t match the imagery rules'}`];
      items.push({ key: `draft:${a.id}`, kind: 'draft', asset_id: a.id, title: a.name, detail: bits.filter(Boolean).join(' · '), actions: ['approve', 'reject', 'open'] });
      continue; // a draft is decided as a whole; no separate duplicate or brand items
    }
    if (a.duplicate_of && !a.duplicate_ok && byId.has(a.duplicate_of)) {
      items.push({ key: `duplicate:${a.id}`, kind: 'duplicate', asset_id: a.id, other_id: a.duplicate_of, title: a.name, detail: `Looks like a copy of “${byId.get(a.duplicate_of)!.name}”`, actions: ['keep_both', 'delete', 'open'] });
    }
    if (a.on_brand === false) {
      items.push({ key: `off_brand:${a.id}`, kind: 'off_brand', asset_id: a.id, title: a.name, detail: short(a.on_brand_reason) || 'Doesn’t match the brand kit’s imagery rules', actions: ['fine', 'delete', 'open'] });
    }
    if (a.ai_status === 'failed') {
      items.push({ key: `failed:${a.id}`, kind: 'failed', asset_id: a.id, title: a.name, detail: short(a.ai_error) || 'Something went wrong', actions: ['retry', 'open'] });
    }
  }
  const bare = files.filter((a) => a.kind === 'product' && !a.storage_path);
  if (bare.length) {
    items.push({ key: 'no_image', kind: 'no_image', asset_ids: bare.map((a) => a.id), title: `${bare.length} product${bare.length === 1 ? '' : 's'} without a photo`, detail: bare.slice(0, 4).map((a) => a.name).join(', ') + (bare.length > 4 ? '…' : ''), actions: ['open_products'] });
  }
  if (!kit || kit.status !== 'approved') {
    items.push({ key: 'brand_kit', kind: 'brand_kit', title: kit ? 'Your brand kit is a draft' : 'No brand kit yet', detail: kit ? 'Check the colours, fonts and logo, then approve it.' : 'Build it from your website or your Figma design system.', actions: ['open_brand_kit'] });
  }
  items.sort((x, y) => ORDER.indexOf(x.kind) - ORDER.indexOf(y.kind));

  // What Mise did for you this week.
  const week = now - 7 * 864e5;
  const t = (v: unknown) => (v ? Date.parse(String(v)) : 0);
  const added = files.filter((a) => t(a.created_at) >= week);
  const summary = {
    added: added.length,
    organised: files.filter((a) => ['done', 'skipped'].includes(a.ai_status) && t(a.ai?.at) >= week).length,
    alt_written: files.filter((a) => t(a.ai?.at) >= week && a.fields?.alt && !(a.edited || []).includes('alt')).length,
    duplicates_found: files.filter((a) => a.duplicate_of && t(a.created_at) >= week).length,
    made: added.filter((a) => a.origin === 'generated').length,
    organising: files.filter((a) => a.ai_status === 'pending').length,
  };
  return { items, count: items.length, summary };
}

// One line for "what Mise did this week".
export function summaryLine(s: ReturnType<typeof reviewQueue>['summary']) {
  const bits: string[] = [];
  if (s.added) bits.push(`${s.added} new file${s.added === 1 ? '' : 's'} came in`);
  if (s.organised) bits.push(`${s.organised} organised with tags and alt text`);
  if (s.made) bits.push(`${s.made} made with Claude or Create`);
  if (s.duplicates_found) bits.push(`${s.duplicates_found} possible duplicate${s.duplicates_found === 1 ? '' : 's'} caught`);
  const line = bits.length ? `This week: ${bits.join(', ')}.` : 'Nothing new this week.';
  return s.organising ? `${line} Organising ${s.organising} now.` : line;
}
