// Smart collections (saved searches that fill themselves) and the plain search over what
// auto-organise found. Shared by the library and, later, portals.

export type Rules = { tags?: string[]; match?: 'any' | 'all'; kinds?: string[]; text?: string; on_brand?: boolean | null; colours?: string[] };
export type Collection = { id: string; workspace_id: string; name: string; rules: Rules; position?: number };
type A = { kind: string; name: string; pid?: string | null; description?: string | null; tags?: string[] | null; text_in_image?: string | null; colour_names?: string[] | null; on_brand?: boolean | null; fields?: any };

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');

// Everything searchable about an asset, in one lowercase string.
export function haystack(a: A) {
  return norm([a.name, a.pid, a.description, (a.tags || []).join(' '), a.text_in_image, (a.colour_names || []).join(' '), a.fields?.alt].filter(Boolean).join(' \n '));
}

// Every word of the query appears somewhere (as the start of a word, so "out" finds "outdoors").
export function matchesQuery(a: A, q: string, hay = haystack(a)) {
  const ws = norm(q).split(/\s+/).filter(Boolean);
  return ws.every((w) => hay.includes(w) && new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(hay));
}

export function matchesRules(a: A, r: Rules) {
  if (a.kind === 'block') return false;
  if (r.kinds?.length && !r.kinds.includes(a.kind)) return false;
  if (typeof r.on_brand === 'boolean' && a.on_brand !== r.on_brand) return false;
  const tags = (a.tags || []).map(norm);
  if (r.tags?.length) {
    const has = (t: string) => tags.some((x) => x === norm(t) || x.split(' ').includes(norm(t)));
    if (r.match === 'all' ? !r.tags.every(has) : !r.tags.some(has)) return false;
  }
  if (r.colours?.length && !r.colours.some((c) => (a.colour_names || []).includes(c))) return false;
  if (r.text && !matchesQuery(a, r.text)) return false;
  return true;
}

export function describeRules(r: Rules) {
  const bits: string[] = [];
  if (r.kinds?.length) bits.push(r.kinds.map((k) => (k === 'logo' ? 'logos' : k === 'product' ? 'products' : k + 's')).join(' or '));
  if (r.tags?.length) bits.push(`tagged ${r.tags.join(r.match === 'all' ? ' and ' : ' or ')}`);
  if (r.colours?.length) bits.push(r.colours.join(' or '));
  if (r.text) bits.push(`matching “${r.text}”`);
  if (r.on_brand === false) bits.push('off-brand');
  if (r.on_brand === true) bits.push('on-brand');
  return bits.join(', ') || 'everything';
}

const GENERIC = new Set(['image', 'photo', 'photograph', 'picture', 'graphic', 'background', 'hero', 'social', 'marketing', 'brand', 'email', 'banner', 'design', 'white', 'black']);
const title = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

// 4–6 starter collections suggested from what's in the library (and not already saved).
export function suggestCollections(items: A[], existing: Collection[]): { name: string; rules: Rules; count: number }[] {
  const tagged = items.filter((i) => i.kind !== 'block' && (i.tags || []).length);
  if (tagged.length < 6) return [];
  const have = new Set(existing.map((c) => JSON.stringify(c.rules)));
  const out: { name: string; rules: Rules; count: number }[] = [];
  const add = (name: string, rules: Rules, min = 2) => {
    if (have.has(JSON.stringify(rules)) || out.some((o) => o.name === name)) return;
    const count = items.filter((i) => matchesRules(i, rules)).length;
    if (count >= min) out.push({ name, rules, count });
  };
  const freq = new Map<string, number>();
  for (const i of tagged) for (const t of new Set(i.tags)) if (!GENERIC.has(t)) freq.set(t, (freq.get(t) || 0) + 1);
  const top = [...freq].filter(([, n]) => n >= 3 && n <= tagged.length * 0.8).sort((a, b) => b[1] - a[1]).map(([t]) => t);
  // A pair that often goes together, e.g. "Lifestyle, summer".
  let pair: [string, string, number] | null = null;
  for (let x = 0; x < Math.min(top.length, 10); x++) for (let y = x + 1; y < Math.min(top.length, 10); y++) {
    const n = tagged.filter((i) => i.tags!.includes(top[x]) && i.tags!.includes(top[y])).length;
    if (n >= 3 && (!pair || n > pair[2])) pair = [top[x], top[y], n];
  }
  if (pair) add(title(`${pair[0]}, ${pair[1]}`), { tags: [pair[0], pair[1]], match: 'all' });
  for (const t of top.slice(0, 4)) add(title(t), { tags: [t] });
  if (items.some((i) => i.kind === 'logo')) add('Logos', { kinds: ['logo'] });
  if (items.some((i) => i.on_brand === false)) add('Off-brand', { on_brand: false }, 1);
  if (freq.get('product shot')) add('Product shots', { tags: ['product shot'] });
  return out.slice(0, 6);
}
