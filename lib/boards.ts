// Create boards: the canvas's data and layout rules. Safe for the browser.
// A board keeps what's on it and where; the files themselves live in the library.
import type { Spec } from './design';

// A design made on the board: its layout lives here until it's saved to the library (asset_id),
// and stays editable after. dirty: changed since it was last saved.
export type DesignState = {
  spec?: Spec; size: { w: number; h: number }; brief: string; run: string; variant?: number; label?: string;
  status: 'loading' | 'ready' | 'refining' | 'error'; error?: string; history?: Spec[]; dirty?: boolean;
};

export type BoardItem = {
  id: string;                 // on this board
  asset_id?: string;          // the file in the library (once it exists)
  x: number; y: number; w: number;   // world units (the canvas at 100%)
  ratio?: number;             // width / height, so a placeholder has the right shape
  url?: string | null;        // a link to show until the library has the file
  name?: string;
  pending?: { kind: 'photo' | 'video'; job?: string; label: string };
  error?: string;
  design?: DesignState;
  product?: boolean;          // a product: its name, price and copy show under the photo
};
export type Turn = {
  id: string; role: 'you' | 'mise'; text: string; at: string;
  refs?: string[];            // asset ids it was about
  made?: string[];            // board item ids it made
  error?: boolean;
};
export type Board = { id: string; workspace_id: string; name: string; items: BoardItem[]; thread: Turn[]; created_by: string | null; updated_at: string };

export const ITEM_W = 280;
export const GAP = 40;
export const PRODUCT_INFO_H = 168; // the product details under the photo, in world units
const H = (i: BoardItem) => i.w / (i.ratio || 1) + (i.product ? PRODUCT_INFO_H : 0);

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: BoardItem) =>
  a.x < b.x + b.w + GAP / 2 && b.x < a.x + a.w + GAP / 2 && a.y < b.y + H(b) + GAP / 2 && b.y < a.y + a.h + GAP / 2;

// Where new things go: in a row to the right of what they were made from, or on a new row under
// everything. Never on top of something already there: if the row is taken, the results drop below
// whatever is in the way, still lined up with what they came from.
export function place(items: BoardItem[], ratios: number[], from?: BoardItem | null, extra: number[] = []): { x: number; y: number; w: number; ratio: number }[] {
  const out: { x: number; y: number; w: number; ratio: number }[] = [];
  const all = [...items];
  const rowX = from ? from.x + from.w + GAP : 0;
  let x = rowX;
  let y = from ? from.y : items.length ? Math.max(...items.map((i) => i.y + H(i))) + GAP * 2 : 0;
  for (const [k, r] of ratios.entries()) {
    const w = (r || 1) >= 2.5 ? Math.round(ITEM_W * 1.6) : ITEM_W, h = w / (r || 1) + (extra[k] || 0); // wide banners get more room
    let hit: BoardItem | undefined, guard = 0;
    while ((hit = all.find((b) => overlaps({ x, y, w, h }, b))) && guard++ < 500) {
      y = hit.y + H(hit) + GAP;
      x = rowX;
    }
    const p = { x, y, w, ratio: r || 1 };
    out.push(p);
    all.push({ id: `tmp${out.length}`, ...p, ratio: w / h });
    x += w + GAP;
  }
  return out;
}

// The box around everything, for "fit to screen".
export function bounds(items: BoardItem[]) {
  if (!items.length) return { x: 0, y: 0, w: 1000, h: 700 };
  const x0 = Math.min(...items.map((i) => i.x)), y0 = Math.min(...items.map((i) => i.y));
  const x1 = Math.max(...items.map((i) => i.x + i.w)), y1 = Math.max(...items.map((i) => i.y + H(i)));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
export const itemHeight = H;
export const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2));
