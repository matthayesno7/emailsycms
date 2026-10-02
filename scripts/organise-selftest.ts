// Checks the auto-organise logic without a database or API key.
// npx tsc scripts/organise-selftest.ts --outDir /tmp/st --module commonjs --target es2022 --esModuleInterop && node /tmp/st/scripts/organise-selftest.js
import { cleanResult, nameTags, patchFrom, shortlist, tagPrompt } from '../lib/autotag';
import { colourName, matchBrand } from '../lib/colours';
import { matchesQuery, matchesRules, suggestCollections } from '../lib/collections';
import { emptyKit } from '../lib/brandKit';

let fails = 0;
const ok = (c: unknown, m: string) => { if (!c) { fails++; console.error('FAIL', m); } else console.log('ok  ', m); };

const kit = emptyKit('Tucker');
kit.colors.primary = '#1f3a93'; kit.colors.accent = '#e8a317';
kit.imagery = { style: 'Natural light, real people outdoors', references: [], do: ['warm tones'], dont: ['studio backdrops'] };
const products = Array.from({ length: 60 }, (_, i) => ({ id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`, name: i === 7 ? 'Blue Canvas Tote Bag' : `Shirt ${i}`, pid: `SKU${i}` }));

// shortlist
ok(shortlist(products.slice(0, 10), 'whatever').length === 10, 'small catalogue: all products');
const sl = shortlist(products, 'summer-tote-bag-final', 'Summer shoot');
ok(sl.length >= 1 && sl[0].name === 'Blue Canvas Tote Bag', 'large catalogue: matches by file name');
ok(shortlist(products, 'IMG_2041').length === 0, 'no name overlap: no products offered');

// prompt
const input = { name: 'summer tote', kind: 'image', folder: 'Summer shoot', kit, products: sl };
const pr = tagPrompt(input);
ok(pr.includes('primary #1f3a93') && pr.includes("Don't: studio backdrops") && pr.includes('Blue Canvas Tote Bag'), 'prompt carries brand kit and products');
ok(tagPrompt({ name: 'x', kind: 'image' }).includes('"on_brand": null'), 'no imagery rules: no brand check asked');

// cleaning
const raw = {
  description: 'A woman walks along a beach at sunset carrying a blue canvas tote bag.',
  tags: ['Woman', 'beach', 'beach', '#summer', 'tote bag', 'lifestyle'],
  colours: ['#1F3B90', 'e9a51a', 'not a colour', '#ffffff'],
  text_in_image: '',
  on_brand: { ok: true, reason: 'Natural light, outdoors, warm tones.' },
  product: { id: sl[0].id, confidence: 'high' },
};
const r = cleanResult(raw, input)!;
ok(r.tags.join('|') === 'woman|beach|summer|tote bag|lifestyle', 'tags lowercased, deduped, # removed');
ok(r.colours.join('|') === '#1f3b90|#e9a51a|#ffffff', 'colours normalised, junk dropped');
ok(r.product?.id === sl[0].id, 'product kept when it was offered');
ok(cleanResult({ ...raw, product: { id: 'made-up', confidence: 'high' } }, input)!.product === null, 'invented product id dropped');
ok(cleanResult({ ...raw, on_brand: { ok: false } }, { ...input, kit: emptyKit() })!.on_brand === null, 'brand check ignored without imagery rules');
ok(cleanResult({}, input) === null, 'empty answer rejected');

// patch
const patch = patchFrom({ kind: 'image', fields: {} }, r, kit, 'haiku');
ok(patch.description === raw.description && patch.tags.length === 5, 'AI fills description and tags');
ok(patch.product_id === sl[0].id, 'high-confidence product linked');
ok(patch.fields.alt.startsWith('A woman walks'), 'alt text filled when empty');
ok(patch.colour_names.includes('navy') || patch.colour_names.includes('blue'), 'colour names for search: ' + patch.colour_names.join(','));
ok(patch.ai.brand_colours[0].role === 'primary' && patch.ai.brand_colours[1].role === 'accent', 'colours matched to brand kit roles');
const kept = patchFrom({ kind: 'image', edited: ['tags', 'description', 'product'], fields: { alt: 'mine' } }, r, kit, 'haiku');
ok(!('tags' in kept) && !('description' in kept) && !('product_id' in kept) && !('fields' in kept), 'people’s edits win (tags, description, product, alt)');
ok(!('product_id' in patchFrom({ kind: 'image', product_id: 'x' }, r, kit, 'h')), 'existing product link left alone');
ok(!('product_id' in patchFrom({ kind: 'image' }, { ...r, product: { id: sl[0].id, confidence: 'medium' } }, kit, 'h')), 'medium confidence only suggests');

// colours
ok(colourName('#ff0000') === 'red' && colourName('#000080') === 'navy' && colourName('#f5f5dc') === 'beige' && colourName('#808080') === 'grey', 'colour names');
ok(matchBrand(['#00ff00'], kit)[0].role === null, 'far colours don’t match the brand');

// search and collections
const a = { kind: 'image', name: 'IMG_2041', ...patch } as any;
ok(matchesQuery(a, 'woman outdoors') === false && matchesQuery(a, 'woman beach'), 'all words must match');
ok(matchesQuery(a, 'tote'), 'word start matches inside tags');
ok(!matchesQuery(a, 'man'), 'no match inside a word (man ≠ woman)');
ok(matchesQuery(a, 'blue'), 'colour names are searchable');
ok(matchesRules(a, { tags: ['summer', 'lifestyle'], match: 'all' }) && !matchesRules(a, { tags: ['studio'] }), 'collection rules');
ok(matchesRules(a, { on_brand: true }) && !matchesRules(a, { on_brand: false }), 'on-brand rule');
const lib = Array.from({ length: 12 }, (_, i) => ({ kind: i < 2 ? 'logo' : 'image', name: `f${i}`, tags: i < 2 ? ['logo'] : i % 2 ? ['lifestyle', 'summer', 'beach'] : ['lifestyle', 'studio'], on_brand: i === 3 ? false : true }));
const sug = suggestCollections(lib as any, []);
console.log('     suggestions:', sug.map((s) => `${s.name} (${s.count})`).join(', '));
ok(sug.length >= 4 && sug.length <= 6 && sug.some((s) => s.name === 'Logos') && sug.some((s) => s.name === 'Off-brand'), '4–6 starter collections');
ok(nameTags('Tucker_Logo_Reversed.svg', 'logo').includes('tucker') && nameTags('x', 'logo')[0] === 'logo', 'name tags for SVGs');

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
