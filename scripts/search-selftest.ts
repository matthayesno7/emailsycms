// Checks the search logic that doesn't need a database or API keys.
// npx tsc scripts/search-selftest.ts --outDir /tmp/st --module commonjs --target es2022 --esModuleInterop --skipLibCheck && node /tmp/st/scripts/search-selftest.js
import { assetText, cleanUnderstood, keepRelevant, understandPrompt, wordCount, toPgVector } from '../lib/search';
import { chipsOf, removeChip, searchKey } from '../lib/searchChips';

let fails = 0;
const ok = (c: unknown, m: string) => { if (!c) { fails++; console.error('FAIL', m); } else console.log('ok  ', m); };
const folders = [{ id: '33333333-3333-3333-3333-333333333333', name: 'Summer shoot 2026' }, { id: '44444444-4444-4444-4444-444444444444', name: 'Press' }];

// Claude's reading of "red product shots, landscape, from the summer shoot"
const u = cleanUnderstood({ text: 'product shots', kinds: ['product', 'spaceship'], colours: ['Red', 'chartreuse'], orientation: 'landscape', folder: 'summer shoot', on_brand: null, origin: 'nonsense', status: null }, folders)!;
ok(u.filters.kinds?.join() === 'product', 'kinds: only valid ones kept');
ok(u.filters.colours?.join() === 'red', 'colours: lowercased, unknown dropped');
ok(u.filters.orientation === 'landscape', 'orientation kept');
ok(u.filters.folder === folders[0].id && u.filters.folder_name === 'Summer shoot 2026', 'folder matched loosely by name');
ok(!('origin' in u.filters) && !('on_brand' in u.filters), 'invalid or null values dropped');
ok(cleanUnderstood({ text: 'x', folder: 'Holiday' }, folders)!.filters.folder === undefined, 'unknown folder ignored');
ok(cleanUnderstood('nope', folders) === null, 'non-object rejected');

const p = understandPrompt('woman outdoors with the blue bag', folders.map((f) => f.name));
ok(p.includes('A colour of one object stays in text') && p.includes('"Summer shoot 2026"'), 'prompt: object colours stay as words; folders listed');
ok(wordCount('  woman  outdoors ') === 2, 'word count');

// relevance cut-off for vector-only matches
const rows = [
  { id: 'a', score: 0.03, fts_rank: 2, vec_rank: 1, similarity: 0.71 },
  { id: 'b', score: 0.02, fts_rank: 1, vec_rank: null, similarity: null },
  { id: 'c', score: 0.016, fts_rank: null, vec_rank: 2, similarity: 0.64 },
  { id: 'd', score: 0.015, fts_rank: null, vec_rank: 3, similarity: 0.52 },
  { id: 'e', score: 0.014, fts_rank: null, vec_rank: 4, similarity: 0.2 },
];
const kept = keepRelevant(rows).map((h) => h.id).join('');
ok(kept === 'abc', `keyword matches always kept; vector-only within 0.12 of best (${kept})`);
ok(keepRelevant([{ id: 'x', score: 0, fts_rank: null, vec_rank: null, similarity: null }]).length === 1, 'filter-only results kept');

const t = assetText({ kind: 'image', name: 'IMG_2041-final', description: 'A woman on a beach.', tags: ['woman', 'beach'], colour_names: ['blue'], text_in_image: 'SALE' });
ok(t.startsWith('Image: IMG 2041 final') && t.includes('Tags: woman, beach') && t.includes('Colours: blue') && t.includes('Text in the image: SALE'), 'embedded text: ' + t);
ok(toPgVector([0.1234567, -1]) === '[0.123457,-1]', 'vector literal for Postgres');

// chips
const chips = chipsOf(u.filters);
ok(chips.map((c) => c.label).join('|') === 'Products|Red|Landscape|In Summer shoot 2026', 'chip labels: ' + chips.map((c) => c.label).join('|'));
const less = removeChip(u.filters, 'colour:red');
ok(!less.colours && less.kinds?.length === 1, 'removing a chip drops just that filter');
ok(removeChip(u.filters, 'folder').folder === undefined, 'remove folder chip');
ok(searchKey('Woman ', {}) === searchKey('woman', {}) && searchKey('a', { kinds: ['logo'] }) !== searchKey('a', {}), 'search keys');

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
