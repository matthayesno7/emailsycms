// Mise's own video generation (Google Veo), server only. A clip takes a minute or two, so it runs as a
// job: start() returns at once, and the clip is saved to the library as a draft when it's ready.
//
// Env: GEMINI_API_KEY. Optional GEMINI_VIDEO_MODEL (default veo-3.1-fast-generate-preview: good quality,
// with sound, at the lower price).
import type { Ref } from './imageGen';

export const hasVideoGen = () => !!process.env.GEMINI_API_KEY;
export const VIDEO_MODEL = () => process.env.GEMINI_VIDEO_MODEL || 'veo-3.1-fast-generate-preview';
export const VIDEO_DESIGNS = 10; // one clip counts as 10 Studio designs
export const VIDEO_ASPECTS = ['16:9', '9:16'] as const;
export const VIDEO_SECONDS = [4, 6, 8] as const;

const BASE = 'https://generativelanguage.googleapis.com/v1beta/';
const key = () => process.env.GEMINI_API_KEY || '';

async function goog(url: string, init: RequestInit = {}) {
  const r = await fetch(url, { ...init, headers: { 'content-type': 'application/json', 'x-goog-api-key': key(), ...(init.headers || {}) } });
  const j: any = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, j };
}

// Start a clip. image: a still to animate (a product photo or a finished design).
export async function startVideo(o: { prompt: string; image?: Ref | null; aspect?: '16:9' | '9:16'; seconds?: number }): Promise<{ job: string; model: string } | { error: string }> {
  if (!key()) return { error: 'Video isn’t switched on (GEMINI_API_KEY).' };
  const model = VIDEO_MODEL();
  const instance: any = { prompt: o.prompt };
  if (o.image) instance.image = { bytesBase64Encoded: o.image.data.toString('base64'), mimeType: o.image.mime };
  const seconds = (VIDEO_SECONDS as readonly number[]).includes(Number(o.seconds)) ? Number(o.seconds) : 8;
  try {
    const r = await goog(`${BASE}models/${encodeURIComponent(model)}:predictLongRunning`, {
      method: 'POST', body: JSON.stringify({ instances: [instance], parameters: { aspectRatio: o.aspect || '16:9', durationSeconds: seconds, personGeneration: o.image ? 'allow_adult' : 'allow_all' } }),
    });
    if (!r.ok || !r.j?.name) return { error: r.j?.error?.message ? `The video model said: ${r.j.error.message}` : `The video model returned ${r.status}.` };
    return { job: r.j.name as string, model };
  } catch (e: any) {
    return { error: `Couldn’t reach the video model (${e?.message || 'network'}).` };
  }
}

// Where a job is. Only Google operation names for Veo models are accepted.
export async function pollVideo(job: string): Promise<{ done: false } | { done: true; uri: string } | { error: string }> {
  if (!/^models\/veo[\w.-]*\/operations\/[\w-]+$/.test(job)) return { error: 'That isn’t a Mise video job.' };
  try {
    const r = await goog(`${BASE}${job}`);
    if (!r.ok) return { error: r.j?.error?.message || `The video model returned ${r.status}.` };
    if (!r.j?.done) return { done: false };
    if (r.j.error) return { error: r.j.error.message || 'The clip couldn’t be made.' };
    const res = r.j.response?.generateVideoResponse || r.j.response;
    const uri = res?.generatedSamples?.[0]?.video?.uri || res?.generatedVideos?.[0]?.video?.uri;
    if (!uri) return { error: res?.raiMediaFilteredReasons?.[0] || 'The clip was blocked by the model’s safety filter. Try rewording the request.' };
    return { done: true, uri };
  } catch (e: any) {
    return { error: `Couldn’t reach the video model (${e?.message || 'network'}).` };
  }
}

export async function downloadVideo(uri: string): Promise<{ buf: Buffer; mime: string } | { error: string }> {
  try {
    const r = await fetch(uri, { headers: { 'x-goog-api-key': key() } });
    if (!r.ok) return { error: `Couldn’t download the clip (${r.status}).` };
    return { buf: Buffer.from(await r.arrayBuffer()), mime: r.headers.get('content-type')?.startsWith('video/') ? r.headers.get('content-type')! : 'video/mp4' };
  } catch (e: any) {
    return { error: `Couldn’t download the clip (${e?.message || 'network'}).` };
  }
}
