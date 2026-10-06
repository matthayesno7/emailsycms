// Mise's own AI image generation, server only. Like the best creative tools, Mise picks a different
// model for each job rather than one model for everything:
//   product  – a real product in a new scene (needs references): Gemini Flash Image ("Nano Banana 2")
//   text     – exact words on the image, hero shots, high-end finish: Gemini Pro Image ("Nano Banana Pro")
//   quick    – fast, cheap variations with no references: Imagen Fast
// Claude chooses with generate_image's purpose (or leaves it on auto). Results land in the library as drafts.
//
// Env: GEMINI_API_KEY (Google AI Studio). Optional overrides: GEMINI_IMAGE_MODEL (product),
// GEMINI_IMAGE_PRO_MODEL (text), GEMINI_IMAGE_FAST_MODEL (quick).
import type { BrandKit } from './brandKit';

export const hasImageGen = () => !!process.env.GEMINI_API_KEY;
export const IMAGE_MODEL = () => process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';

export const PURPOSES = ['auto', 'product', 'text', 'quick'] as const;
export type Purpose = (typeof PURPOSES)[number];
type Route = { purpose: Exclude<Purpose, 'auto'>; model: string; api: 'gemini' | 'imagen'; size: '1K' | '2K'; designs: number; label: string };

// Which model does which job, and what it counts against the brand's Studio designs.
const ROUTES: Record<Exclude<Purpose, 'auto'>, () => Route> = {
  product: () => ({ purpose: 'product', model: IMAGE_MODEL(), api: 'gemini', size: '2K', designs: 1, label: 'Product in a scene' }),
  text: () => ({ purpose: 'text', model: process.env.GEMINI_IMAGE_PRO_MODEL || 'gemini-3-pro-image-preview', api: 'gemini', size: '2K', designs: 2, label: 'Exact text or hero shot' }),
  quick: () => ({ purpose: 'quick', model: process.env.GEMINI_IMAGE_FAST_MODEL || 'imagen-4.0-fast-generate-001', api: 'imagen', size: '1K', designs: 1, label: 'Quick variations' }),
};
const IMAGEN_ASPECTS = ['1:1', '3:4', '4:3', '9:16', '16:9'];

// Pick the model. Auto: references → product; quoted words → text; otherwise product's model (good all-rounder).
// Imagen can't take references or every aspect, so those fall back to the product model.
export function routeFor(purpose: Purpose | undefined, o: { prompt: string; refs: number; aspect: Aspect }): Route {
  let p: Exclude<Purpose, 'auto'> = purpose && purpose !== 'auto' ? purpose : o.refs ? 'product' : /["“][^"“”]{2,}["”]/.test(o.prompt) ? 'text' : 'product';
  if (p === 'quick' && (o.refs > 0 || !IMAGEN_ASPECTS.includes(o.aspect))) p = 'product';
  return ROUTES[p]();
}
export const designsFor = (r: Route, count: number) => r.designs * count;

export const ASPECTS = ['1:1', '4:5', '3:4', '2:3', '9:16', '16:9', '3:2', '4:3', '21:9'] as const;
export type Aspect = (typeof ASPECTS)[number];

export type Ref = { mime: string; data: Buffer; label?: string };

// The brand's imagery rules, written into every request so new images look like the brand's own.
export function brandPrompt(prompt: string, kit: BrandKit | null, opts: { hasProduct?: boolean } = {}) {
  const lines = [prompt.trim()];
  const im = kit?.imagery;
  if (im?.style) lines.push(`Photographic style: ${im.style}`);
  if (im?.do?.length) lines.push(`Do: ${im.do.join('; ')}.`);
  if (im?.dont?.length) lines.push(`Don't: ${im.dont.join('; ')}.`);
  if (opts.hasProduct) lines.push('Keep the product in the reference image exactly as it is: same shape, colours, materials, logo and proportions. Only change its surroundings, lighting and setting.');
  lines.push('No watermarks. No text unless the request asks for it; any text must be spelled exactly as given.');
  return lines.join('\n');
}

type Out = { bufs: Buffer[]; mime: string; model: string } | { error: string; missingModel?: boolean };

async function call(url: string, body: unknown, key: string): Promise<{ ok: boolean; status: number; j: any } | { error: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body), signal: ctrl.signal });
    return { ok: r.ok, status: r.status, j: await r.json().catch(() => null) };
  } catch (e: any) {
    return { error: e?.name === 'AbortError' ? 'The image took too long. Try again.' : `Couldn’t reach the image model (${e?.message || 'network'}).` };
  } finally {
    clearTimeout(timer);
  }
}

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const failed = (status: number, j: any): Out => ({
  error: j?.error?.message ? `The image model said: ${j.error.message}` : `The image model returned ${status}.`,
  missingModel: status === 404 || /not found|not supported/i.test(j?.error?.message || ''),
});

// Gemini image models: one image per call, references allowed.
async function viaGemini(model: string, o: { prompt: string; refs: Ref[]; aspect: Aspect; size: '1K' | '2K'; count: number }, key: string): Promise<Out> {
  const parts: any[] = [{ text: o.prompt }];
  for (const r of o.refs.slice(0, 6)) parts.push({ inlineData: { mimeType: r.mime, data: r.data.toString('base64') } });
  const body = { contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: o.aspect, imageSize: o.size } } };
  const runs = await Promise.all(Array.from({ length: o.count }, () => call(`${BASE}${encodeURIComponent(model)}:generateContent`, body, key)));
  const bufs: Buffer[] = [];
  let mime = 'image/png';
  let last: Out | null = null;
  for (const res of runs) {
    if ('error' in res) { last = { error: res.error }; continue; }
    if (!res.ok) { last = failed(res.status, res.j); continue; }
    const out = (res.j?.candidates?.[0]?.content?.parts || []).find((p: any) => p.inlineData?.data || p.inline_data?.data);
    const d = out?.inlineData || out?.inline_data;
    if (!d?.data) {
      const reason = res.j?.candidates?.[0]?.finishReason || res.j?.promptFeedback?.blockReason;
      last = { error: reason ? `No image came back (${reason}). Try rewording the request.` : 'No image came back. Try rewording the request.' };
      continue;
    }
    bufs.push(Buffer.from(d.data, 'base64'));
    mime = d.mimeType || d.mime_type || mime;
  }
  return bufs.length ? { bufs, mime, model } : last || { error: 'No image came back.' };
}

// Imagen: several images in one call, no references.
async function viaImagen(model: string, o: { prompt: string; aspect: Aspect; count: number }, key: string): Promise<Out> {
  const res = await call(`${BASE}${encodeURIComponent(model)}:predict`, { instances: [{ prompt: o.prompt }], parameters: { sampleCount: o.count, aspectRatio: o.aspect, personGeneration: 'allow_adult' } }, key);
  if ('error' in res) return { error: res.error };
  if (!res.ok) return failed(res.status, res.j);
  const preds = (res.j?.predictions || []).filter((p: any) => p?.bytesBase64Encoded);
  if (!preds.length) return { error: 'No image came back. Try rewording the request.' };
  return { bufs: preds.map((p: any) => Buffer.from(p.bytesBase64Encoded, 'base64')), mime: preds[0].mimeType || 'image/png', model };
}

// Make 1–4 images with the route's model. If that model isn't available on this key, fall back to the
// product model so a missing preview model never breaks generation.
export async function generateImages(o: { prompt: string; refs?: Ref[]; aspect?: Aspect; route: Route; count?: number }): Promise<{ bufs: Buffer[]; mime: string; model: string; route: Route } | { error: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { error: 'Image generation isn’t switched on (GEMINI_API_KEY).' };
  const count = Math.max(1, Math.min(4, o.count || 1));
  const aspect = o.aspect || '1:1';
  const refs = o.refs || [];
  let route = o.route;
  let out = route.api === 'imagen'
    ? await viaImagen(route.model, { prompt: o.prompt, aspect, count }, key)
    : await viaGemini(route.model, { prompt: o.prompt, refs, aspect, size: route.size, count }, key);
  if ('error' in out && out.missingModel && route.model !== IMAGE_MODEL()) {
    console.warn('[imageGen] model unavailable, falling back:', route.model);
    route = { ...ROUTES.product(), designs: route.designs };
    out = await viaGemini(route.model, { prompt: o.prompt, refs, aspect, size: route.size, count }, key);
  }
  if ('error' in out) return { error: out.error };
  return { ...out, route };
}

// One image with the default model (kept for existing callers).
export async function generateImage(o: { prompt: string; refs?: Ref[]; aspect?: Aspect; size?: '1K' | '2K' }): Promise<{ buf: Buffer; mime: string; model: string } | { error: string }> {
  const r = await generateImages({ prompt: o.prompt, refs: o.refs, aspect: o.aspect, route: { ...ROUTES.product(), size: o.size || '1K' } });
  return 'error' in r ? r : { buf: r.bufs[0], mime: r.mime, model: r.model };
}
