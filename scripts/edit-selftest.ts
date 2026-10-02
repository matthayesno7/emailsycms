// Checks the Edit maths (crop, resize, rotate, presets, adjustments) without a browser.
// npx tsc scripts/edit-selftest.ts --outDir /tmp/st --module commonjs --target es2022 --esModuleInterop --skipLibCheck && node /tmp/st/scripts/edit-selftest.js
import { NO_EDIT, adjustPixels, centredCrop, cleanTeamPresets, cropPixels, describe, dragCrop, isUnchanged, outputSize, outputType, presetGroups, turned } from '../lib/imageEdit';
import { emptyKit, normaliseKit } from '../lib/brandKit';

let fails = 0;
const ok = (c: unknown, m: string) => { if (!c) { fails++; console.error('FAIL', m); } else console.log('ok  ', m); };
const near = (a: number, b: number, e = 1e-6) => Math.abs(a - b) < e;

ok(isUnchanged(NO_EDIT) && !isUnchanged({ ...NO_EDIT, rotate: 90 }), 'unchanged detection');
ok(turned(4000, 3000, 90).w === 3000 && turned(4000, 3000, 180).w === 4000, 'rotation swaps width and height');

// A 1200×600 email crop from a 4000×3000 photo: full width, centred, then resized.
const c = centredCrop(2, { w: 4000, h: 3000 });
ok(near(c.w, 1) && near(c.h, 4000 / 2 / 3000) && near(c.y, (1 - c.h) / 2), 'centred crop at 2:1');
const e1 = { ...NO_EDIT, crop: c, ratio: 2, out: { w: 1200, h: 600 } };
ok(cropPixels(e1, 4000, 3000).w === 4000 && cropPixels(e1, 4000, 3000).h === 2000, 'crop in pixels');
ok(outputSize(e1, 4000, 3000).w === 1200, 'output is the preset size');
ok(describe(e1, 4000, 3000) === 'Resized to 1200×600', 'describe: ' + describe(e1, 4000, 3000));
const around = centredCrop(1, { w: 4000, h: 3000 }, { x: 0.95, y: 0.5 });
ok(near(around.x + around.w, 1), 'crop follows the focal point but stays inside');

// Portrait crop on a rotated picture
const e2 = { ...NO_EDIT, rotate: 90 as const, crop: centredCrop(4 / 5, turned(4000, 3000, 90)), ratio: 0.8 };
const px = cropPixels(e2, 4000, 3000);
ok(Math.abs(px.w / px.h - 0.8) < 0.01, `rotated 4:5 crop keeps its ratio (${px.w}×${px.h})`);
ok(describe(e2, 4000, 3000).startsWith('Cropped to') && describe(e2, 4000, 3000).includes('rotated 90°'), 'describe crop + rotate');

// Dragging: move stays inside; locked resize keeps ratio; free resize doesn't.
const box = { x: 0.2, y: 0.2, w: 0.4, h: 0.3 };
const moved = dragCrop(box, 'move', 0.9, 0.9, null);
ok(near(moved.x, 0.6) && near(moved.y, 0.7), 'move is clamped to the picture');
const rN = 0.4 / 0.3;
const grown = dragCrop(box, 'se', 0.1, 0.02, rN);
ok(near(grown.w / grown.h, rN, 1e-9) && grown.x === 0.2 && grown.y === 0.2, 'locked resize keeps the ratio and the fixed corner');
const nw = dragCrop(box, 'nw', -0.5, -0.5, rN);
ok(nw.x >= 0 && nw.y >= 0 && near(nw.x + nw.w, 0.6) && near(nw.w / nw.h, rN, 1e-9), 'locked resize from the top-left stops at the edge');
const free = dragCrop(box, 'se', 0.1, -0.1, null);
ok(near(free.w, 0.5) && near(free.h, 0.2), 'free resize');
ok(dragCrop(box, 'se', -1, -1, null).w >= 0.04, 'a crop never collapses');

// Presets: email from the kit width, social, retail and the team's own.
const kit = normaliseKit({ ...emptyKit('Oak'), layout: { width: 640, radius: 0, spacing: 24 }, presets: [{ name: 'John Lewis hero', w: 1920, h: 800 }, { name: '', w: 1, h: 1 }] });
const g = presetGroups(kit);
const email = g.find((x) => x.name === 'Email')!.items[0];
ok(email.w === 1280 && email.h === 640, 'email full width follows the brand kit (640 → 1280×640)');
ok(g.some((x) => x.name === 'Social' && x.items.some((i) => i.w === 1128 && i.h === 191)), 'social sizes from the Studio formats');
ok(g.find((x) => x.name === 'Your team')?.items.length === 1, 'team sizes kept, junk dropped by the brand kit');
ok(cleanTeamPresets([{ name: 'A', w: 100, h: 100 }, { name: 'B', w: 9, h: 100 }]).length === 1, 'team size validation');

// Adjustments on pixels
const px1 = new Uint8ClampedArray([100, 150, 200, 255]);
adjustPixels(px1, 20, 0, 0);
ok(px1[0] > 100 && px1[2] > 200, 'brighter raises every channel');
const px2 = new Uint8ClampedArray([200, 100, 50, 255]);
adjustPixels(px2, 0, 0, -100);
ok(px2[0] === px2[1] && px2[1] === px2[2], 'saturation −100 makes it grey');
const px3 = new Uint8ClampedArray([160, 128, 96, 255]);
adjustPixels(px3, 0, 50, 0);
ok(px3[0] > 160 && px3[2] < 96 && px3[1] === 128, 'contrast pivots on mid-grey');

ok(outputType('image/jpeg', NO_EDIT) === 'image/jpeg' && outputType('image/jpeg', { ...NO_EDIT, cutWhite: true }) === 'image/png' && outputType('image/webp', NO_EDIT) === 'image/webp', 'output format');

console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
