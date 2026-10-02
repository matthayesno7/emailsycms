// AI search, shared by the library (/api/search) and the Claude connector (MCP).
// 1. Optionally, Claude turns a plain-language query into filters plus search words.
// 2. Voyage embeds the words; Postgres blends vector similarity with full-text ranking
//    (search_assets in supabase/migrations/20261002120000_search.sql) and applies the filters.
import type { SupabaseClient } from '@supabase/supabase-js';
import { jsonFrom } from './anthropic';
import { TAG_MODEL } from './autotag';
import type { SearchFilters } from './searchChips';

export const VOYAGE_MODEL = process.env.VOYAGE_MODEL || 'voyage-3.5';
export const EMBED_DIMS = 1024;
export const hasVoyage = () => !!process.env.VOYAGE_API_KEY;

// kinds, colours (plain names, see lib/colours.ts), orientation, folder (+ name for the chip), on_brand, origin, status
export type Filters = SearchFilters;
export type Hit = { id: string; score: number; similarity: number | null; fts: boolean };
export type SearchResult = { hits: Hit[]; text: string; filters: Filters; vector: boolean; understood: boolean };

export const COLOUR_WORDS = ['red', 'burgundy', 'pink', 'magenta', 'orange', 'peach', 'brown', 'beige', 'yellow', 'olive', 'green', 'dark green', 'teal', 'blue', 'light blue', 'navy', 'purple', 'black', 'white', 'grey', 'light grey', 'charcoal'];
const KINDS = ['image', 'logo', 'product', 'video'];

// ---------- small in-memory caches (per server process) ----------
function lru<V>(max: number) {
  const m = new Map<string, V>();
  return {
    get(k: string) { const v = m.get(k); if (v !== undefined) { m.delete(k); m.set(k, v); } return v; },
    set(k: string, v: V) { m.set(k, v); if (m.size > max) m.delete(m.keys().next().value as string); },
  };
}
const queryVectors = lru<number[]>(500);
const understood = lru<{ text: string; filters: Filters }>(500);

// ---------- Voyage ----------
export async function embed(texts: string[], inputType: 'query' | 'document'): Promise<number[][] | null> {
  const key = process.env.VOYAGE_API_KEY;
  if (!key || !texts.length) return null;
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ input: texts, model: VOYAGE_MODEL, input_type: inputType, output_dimension: EMBED_DIMS }),
  });
  if (res.status === 429) throw Object.assign(new Error('Voyage rate limit'), { limited: true });
  if (!res.ok) { console.error('[search] Voyage', res.status, (await res.text().catch(() => '')).slice(0, 200)); return null; }
  const out = await res.json().catch(() => null);
  const data = (out?.data || []) as { embedding: number[]; index: number }[];
  if (data.length !== texts.length) return null;
  return data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

export async function queryVector(text: string) {
  const k = text.trim().toLowerCase();
  if (!k || !hasVoyage()) return null;
  const hit = queryVectors.get(k);
  if (hit) return hit;
  try {
    const v = (await embed([k], 'query'))?.[0] || null;
    if (v) queryVectors.set(k, v);
    return v;
  } catch { return null; }
}

export const toPgVector = (v: number[]) => `[${v.map((x) => +x.toFixed(6)).join(',')}]`;

// What gets embedded for an asset: everything a person might search for.
export function assetText(a: { kind: string; name: string; description?: string | null; tags?: string[] | null; colour_names?: string[] | null; text_in_image?: string | null; pid?: string | null; fields?: any }) {
  const kind = a.kind === 'logo' ? 'Logo' : a.kind === 'product' ? 'Product' : a.kind === 'video' ? 'Video' : 'Image';
  return [
    `${kind}: ${a.name.replace(/[_\-.]+/g, ' ')}`,
    a.description || a.fields?.description || a.fields?.alt || '',
    a.tags?.length ? `Tags: ${a.tags.join(', ')}` : '',
    a.colour_names?.length ? `Colours: ${a.colour_names.join(', ')}` : '',
    a.text_in_image ? `Text in the image: ${a.text_in_image}` : '',
    a.pid ? `Product ID ${a.pid}` : '',
  ].filter(Boolean).join('. ').slice(0, 2000);
}

// ---------- understanding the query ----------
export const wordCount = (q: string) => q.trim().split(/\s+/).filter(Boolean).length;

export function understandPrompt(q: string, folders: string[]) {
  return [
    'Turn this search of a brand\'s asset library into filters plus the words to search for. Reply with JSON only:',
    '{"text": "what to search for, minus the words used as filters", "kinds": [], "colours": [], "orientation": null, "folder": null, "on_brand": null, "origin": null, "status": null}',
    `- kinds: any of ${KINDS.join(', ')}, only when the query clearly asks for that type ("product shots" → product, "logos" → logo, "videos" → video, "photos"/"images" → image).`,
    `- colours: from [${COLOUR_WORDS.join(', ')}], only when a colour describes the whole picture ("red product shots", "blue backgrounds", "black and white"). A colour of one object stays in text ("the woman with the blue bag" → text "woman with blue bag", no colour filter).`,
    '- orientation: landscape, portrait or square, only if asked ("wide", "horizontal" → landscape; "tall", "vertical", "stories" → portrait).',
    folders.length ? `- folder: the exact name of one of these folders if the query refers to it (e.g. "from the summer shoot"): ${folders.slice(0, 80).map((f) => JSON.stringify(f)).join(', ')}. Otherwise null.` : '- folder: null',
    '- on_brand: false for "off-brand"/"not on brand", true for "on-brand"; else null.',
    '- origin: "generated" for "made with AI"/"generated"; "product_feed" for "from the feed"; else null.',
    '- status: "draft" for "drafts"/"to review"/"not approved"; else null.',
    'Keep text short and concrete. If everything became a filter, text can be empty.',
    `Search: ${JSON.stringify(q)}`,
  ].join('\n');
}

export function cleanUnderstood(raw: any, folders: { id: string; name: string }[]): { text: string; filters: Filters } | null {
  if (!raw || typeof raw !== 'object') return null;
  const f: Filters = {};
  const kinds = (Array.isArray(raw.kinds) ? raw.kinds : []).map(String).filter((k: string) => KINDS.includes(k));
  if (kinds.length) f.kinds = [...new Set(kinds)] as string[];
  const colours = (Array.isArray(raw.colours) ? raw.colours : []).map((c: unknown) => String(c).toLowerCase()).filter((c: string) => COLOUR_WORDS.includes(c));
  if (colours.length) f.colours = [...new Set(colours)] as string[];
  if (['landscape', 'portrait', 'square'].includes(raw.orientation)) f.orientation = raw.orientation;
  if (raw.folder) {
    const n = String(raw.folder).toLowerCase();
    const hit = folders.find((x) => x.name.toLowerCase() === n) || folders.find((x) => x.name.toLowerCase().includes(n) || n.includes(x.name.toLowerCase()));
    if (hit) { f.folder = hit.id; f.folder_name = hit.name; }
  }
  if (typeof raw.on_brand === 'boolean') f.on_brand = raw.on_brand;
  if (['uploaded', 'product_feed', 'generated'].includes(raw.origin)) f.origin = raw.origin;
  if (['draft', 'approved'].includes(raw.status)) f.status = raw.status;
  const text = typeof raw.text === 'string' ? raw.text.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
  return { text, filters: f };
}

async function understand(q: string, folders: { id: string; name: string }[]) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const ck = q.trim().toLowerCase() + '|' + folders.map((f) => f.id).join(',');
  const hit = understood.get(ck);
  if (hit) return hit;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: TAG_MODEL, max_tokens: 250, messages: [{ role: 'user', content: understandPrompt(q, folders.map((f) => f.name)) }] }),
  }).catch(() => null);
  if (!res?.ok) return null;
  const out = await res.json().catch(() => null);
  const r = cleanUnderstood(jsonFrom(String(out?.content?.find((c: any) => c.type === 'text')?.text || '')), folders);
  if (r) understood.set(ck, r);
  return r;
}

// Vector-only matches below this are noise: keep those close to the best match.
const MIN_SIM = Number(process.env.SEARCH_MIN_SIMILARITY || 0.25);
const SIM_WINDOW = Number(process.env.SEARCH_SIMILARITY_WINDOW || 0.12);

export function keepRelevant(rows: { id: string; score: number; fts_rank: number | null; vec_rank: number | null; similarity: number | null }[]): Hit[] {
  const top = Math.max(0, ...rows.map((r) => r.similarity ?? 0));
  return rows
    .filter((r) => r.fts_rank != null || r.similarity == null || (r.similarity >= MIN_SIM && r.similarity >= top - SIM_WINDOW))
    .map((r) => ({ id: r.id, score: r.score, similarity: r.similarity, fts: r.fts_rank != null }));
}

// The search itself. db is the caller's client (row level security applies) or the
// service-role client with workspace ids already checked.
export async function searchAssets(db: SupabaseClient, o: { ws: string[]; q: string; filters?: Filters; understand?: boolean; limit?: number }): Promise<SearchResult> {
  let text = (o.q || '').trim();
  let filters: Filters = { ...(o.filters || {}) };
  let didUnderstand = false;
  if (o.understand && wordCount(text) >= 3) {
    const { data: folders } = await db.from('folders').select('id, name').in('workspace_id', o.ws).limit(500);
    // Embed the raw query at the same time, in case understanding leaves the words unchanged.
    const [u] = await Promise.all([understand(text, folders || []), queryVector(text)]);
    if (u) { text = u.text; filters = { ...u.filters, ...filters }; didUnderstand = true; }
  }
  const vec = text ? await queryVector(text) : null;
  const { data, error } = await db.rpc('search_assets', {
    p_ws: o.ws, p_q: text || null, p_emb: vec ? toPgVector(vec) : null,
    p_kinds: filters.kinds?.length ? filters.kinds : null, p_colours: filters.colours?.length ? filters.colours : null,
    p_orientation: filters.orientation || null, p_folders: filters.folder ? [filters.folder] : null,
    p_on_brand: typeof filters.on_brand === 'boolean' ? filters.on_brand : null,
    p_origin: filters.origin || null, p_status: filters.status || null, p_n: o.limit || 60,
  });
  if (error) throw new Error(error.message);
  return { hits: keepRelevant((data || []) as any[]), text, filters, vector: !!vec, understood: didUnderstand };
}
