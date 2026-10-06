// Which AI model Mise uses for each job, and how they're named to people. Safe for the browser.
// The server (imageGen.ts, videoGen.ts) holds the actual model ids, which can be overridden by env.

export const PURPOSES = ['auto', 'product', 'text', 'quick'] as const;
export type Purpose = (typeof PURPOSES)[number];
export type Job = Exclude<Purpose, 'auto'>;

export const JOBS: Record<Job, { label: string; model: string; designs: number; good: string }> = {
  product: { label: 'Product in a scene', model: 'Nano Banana 2', designs: 1, good: 'Keeps your product exact in a new setting' },
  text: { label: 'Words and hero shots', model: 'Nano Banana Pro', designs: 2, good: 'Spells words exactly; sharpest finish' },
  quick: { label: 'Quick variations', model: 'Imagen 4 Fast', designs: 1, good: 'Fast takes to choose from; no reference photo' },
};
export const VIDEO_JOB = { label: 'Video clip', model: 'Veo 3.1 Fast', designs: 10, good: 'Short clips with sound, from words or a photo' };

export const IMAGEN_ASPECTS = ['1:1', '3:4', '4:3', '9:16', '16:9'];

// Auto: a reference photo → product; words in quotes → text; otherwise product (the best all-rounder).
// Quick can't take references or every shape, so those go to product.
export function pickJob(purpose: Purpose | undefined, o: { prompt: string; refs: number; aspect: string }): Job {
  let p: Job = purpose && purpose !== 'auto' ? purpose : o.refs ? 'product' : /["“][^"“”]{2,}["”]/.test(o.prompt) ? 'text' : 'product';
  if (p === 'quick' && (o.refs > 0 || !IMAGEN_ASPECTS.includes(o.aspect))) p = 'product';
  return p;
}

// A model id as people know it ("gemini-3.1-flash-image" → "Nano Banana 2").
export function modelName(id?: string | null) {
  const m = String(id || '').toLowerCase();
  if (!m) return '';
  if (m.includes('veo')) return `Veo ${m.match(/veo-?(\d+(?:\.\d+)?)/)?.[1] || ''}${m.includes('fast') ? ' Fast' : ''}`.replace('  ', ' ').trim();
  if (m.includes('imagen')) return `Imagen ${m.match(/imagen-?(\d+)/)?.[1] || ''}${m.includes('fast') ? ' Fast' : m.includes('ultra') ? ' Ultra' : ''}`.trim();
  if (m.includes('pro-image')) return 'Nano Banana Pro';
  if (m.includes('flash') && m.includes('image')) return m.includes('2.5') ? 'Nano Banana' : 'Nano Banana 2';
  if (m.includes('claude')) return 'Claude';
  return id || '';
}

// The shape a size asks for, as the nearest aspect ratio the models make.
const RATIOS: [string, number][] = [['1:1', 1], ['4:5', 0.8], ['3:4', 0.75], ['2:3', 2 / 3], ['9:16', 9 / 16], ['16:9', 16 / 9], ['3:2', 1.5], ['4:3', 4 / 3], ['21:9', 21 / 9]];
export function nearestAspect(w: number, h: number, allowed?: string[]) {
  const r = w / h;
  return RATIOS.filter(([a]) => !allowed || allowed.includes(a)).reduce((b, x) => (Math.abs(Math.log(x[1] / r)) < Math.abs(Math.log(b[1] / r)) ? x : b))[0];
}
