import { createClient } from '@/lib/supabase/server';

// Optional AI alt text for email images. Needs ANTHROPIC_API_KEY (ANTHROPIC_MODEL optional);
// without it the app simply skips alt text suggestions.

export const runtime = 'nodejs';
export const maxDuration = 30;

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return Response.json({ error: 'not_configured' }, { status: 501 });

  const body = await request.json().catch(() => null);
  const image = String(body?.image || '');
  if (!image) return Response.json({ error: 'Missing image.' }, { status: 400 });
  if (image.length > 2_000_000) return Response.json({ error: 'Image too large.' }, { status: 413 });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
          { type: 'text', text: 'Write alt text for this image as it would appear in a marketing email. One plain sentence, under 120 characters, describing what matters (product, people, setting, any text in the image). No "image of" or "picture of". Reply with the alt text only.' },
        ],
      }],
    }),
  });
  if (!res.ok) return Response.json({ error: `Alt text failed (${res.status}).` }, { status: 502 });
  const out = await res.json();
  const alt = String(out?.content?.find((c: any) => c.type === 'text')?.text || '').trim().replace(/^["“]|["”]$/g, '').slice(0, 150);
  return Response.json({ alt });
}
