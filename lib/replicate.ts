// Replicate: background removal and upscaling, the two board tools Mise's other models can't do
// (a real transparent cut-out, and more pixels). Server only. Env: REPLICATE_API_TOKEN, and to swap
// models REPLICATE_REMOVE_BG_MODEL / REPLICATE_UPSCALE_MODEL (owner/name of an official model).
export const hasReplicate = () => !!process.env.REPLICATE_API_TOKEN;
export const REMOVE_BG_MODEL = () => process.env.REPLICATE_REMOVE_BG_MODEL || 'bria/remove-background';
export const UPSCALE_MODEL = () => process.env.REPLICATE_UPSCALE_MODEL || 'topazlabs/image-upscale';

async function api(path: string, init: RequestInit = {}) {
  const r = await fetch(`https://api.replicate.com/v1/${path}`, {
    ...init,
    headers: { authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`, 'content-type': 'application/json', ...(init.headers || {}) },
  });
  const j: any = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, j };
}

// Run an official model and wait for it (up to about 90 seconds). Returns the first output file's URL.
export async function runModel(model: string, input: Record<string, unknown>): Promise<{ url: string } | { error: string }> {
  if (!hasReplicate()) return { error: 'This tool isn’t switched on yet (REPLICATE_API_TOKEN).' };
  let { ok, status, j } = await api(`models/${model}/predictions`, { method: 'POST', headers: { prefer: 'wait=60' }, body: JSON.stringify({ input }) });
  if (!ok) return { error: j?.detail || j?.error || `The ${model} model returned ${status}.` };
  const stop = Date.now() + 90_000;
  while (['starting', 'processing'].includes(j?.status) && Date.now() < stop) {
    await new Promise((r) => setTimeout(r, 1500));
    ({ ok, j } = await api(`predictions/${j.id}`));
    if (!ok) break;
  }
  if (j?.status !== 'succeeded') return { error: j?.error ? `The model said: ${String(j.error).slice(0, 200)}` : 'The model didn’t finish in time. Try again.' };
  const out = Array.isArray(j.output) ? j.output[0] : typeof j.output === 'object' && j.output ? (j.output.image || j.output.url || Object.values(j.output)[0]) : j.output;
  return typeof out === 'string' && /^https?:/.test(out) ? { url: out } : { error: 'The model didn’t return an image.' };
}

export async function fetchFile(url: string): Promise<{ buf: Buffer; mime: string } | null> {
  const r = await fetch(url).catch(() => null);
  if (!r?.ok) return null;
  return { buf: Buffer.from(await r.arrayBuffer()), mime: r.headers.get('content-type') || 'image/png' };
}
