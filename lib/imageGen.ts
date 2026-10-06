// Mise's own AI image generation (Google's Gemini image models, "Nano Banana"), server only.
// So people without Figma can still get new photography and finished images: Claude calls the
// generate_image tool, and the result is saved to the library as a draft to approve.
//
// Env: GEMINI_API_KEY (Google AI Studio), optional GEMINI_IMAGE_MODEL (default gemini-3.1-flash-image).
import type { BrandKit } from './brandKit';

export const hasImageGen = () => !!process.env.GEMINI_API_KEY;
export const IMAGE_MODEL = () => process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image';

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

// One image. Returns the file, or an error to show.
export async function generateImage(o: { prompt: string; refs?: Ref[]; aspect?: Aspect; size?: '1K' | '2K' }): Promise<{ buf: Buffer; mime: string; model: string } | { error: string }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { error: 'Image generation isn’t switched on (GEMINI_API_KEY).' };
  const model = IMAGE_MODEL();
  const parts: any[] = [{ text: o.prompt }];
  for (const r of (o.refs || []).slice(0, 6)) parts.push({ inlineData: { mimeType: r.mime, data: r.data.toString('base64') } });
  const body = {
    contents: [{ role: 'user', parts }],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: o.aspect || '1:1', imageSize: o.size || '1K' } },
  };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90_000);
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body), signal: ctrl.signal,
    });
    const j: any = await r.json().catch(() => null);
    if (!r.ok) return { error: j?.error?.message ? `The image model said: ${j.error.message}` : `The image model returned ${r.status}.` };
    const out = (j?.candidates?.[0]?.content?.parts || []).find((p: any) => p.inlineData?.data || p.inline_data?.data);
    const d = out?.inlineData || out?.inline_data;
    if (!d?.data) {
      const reason = j?.candidates?.[0]?.finishReason || j?.promptFeedback?.blockReason;
      return { error: reason ? `No image came back (${reason}). Try rewording the request.` : 'No image came back. Try rewording the request.' };
    }
    return { buf: Buffer.from(d.data, 'base64'), mime: d.mimeType || d.mime_type || 'image/png', model };
  } catch (e: any) {
    return { error: e?.name === 'AbortError' ? 'The image took too long. Try again.' : `Couldn’t reach the image model (${e?.message || 'network'}).` };
  } finally {
    clearTimeout(timer);
  }
}
