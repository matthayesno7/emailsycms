import { createClient } from '@/lib/supabase/server';

// Reads a finished design (one flat image) with Claude and returns its copy, layout and
// photo area, so Emailsy can save it as an editable Card block.
// Needs ANTHROPIC_API_KEY. ANTHROPIC_MODEL is optional.

export const runtime = 'nodejs';
export const maxDuration = 60;

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

const SCHEMA = {
  type: 'object',
  properties: {
    is_design: { type: 'boolean', description: 'True if the image is a finished email design with copy in it (headline, text, button...). False if it is just a photo or graphic with no real copy.' },
    layout: { type: 'string', enum: ['top', 'left', 'right'], description: 'Where the photo sits relative to the copy. Use top for photo above copy, or when copy sits over the photo.' },
    photo: {
      type: ['object', 'null'],
      description: 'Pixel box of the main photo on the image as sent: only the photo, excluding copy, buttons and plain background. Null if there is no photo.',
      properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } },
      required: ['x', 'y', 'width', 'height'],
    },
    eyebrow: { type: 'string', description: 'Small label or sub header above the headline, or empty.' },
    headline: { type: 'string', description: 'The main headline, exactly as written but in normal sentence or title case (not all caps unless it is a brand name).' },
    rating: { type: 'integer', minimum: 0, maximum: 5, description: 'Number of stars in a star rating, or 0 if there is none.' },
    body: { type: 'string', description: 'Paragraph or quote text, exactly as written, without surrounding quotation marks.' },
    name: { type: 'string', description: 'Attribution name (e.g. reviewer name), or empty.' },
    cta: { type: 'string', description: 'Button or link label, exactly as written, or empty.' },
  },
  required: ['is_design', 'layout', 'photo', 'eyebrow', 'headline', 'rating', 'body', 'name', 'cta'],
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Sign in first.' }, { status: 401 });

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return Response.json({ error: 'not_configured' }, { status: 501 });

  const body = await request.json().catch(() => null);
  const workspaceId = String(body?.workspace_id || '');
  const image = String(body?.image || '');
  const width = Number(body?.width) || 0, height = Number(body?.height) || 0;
  if (!workspaceId || !image || !width || !height) return Response.json({ error: 'Missing image.' }, { status: 400 });
  if (image.length > 6_000_000) return Response.json({ error: 'Image too large.' }, { status: 413 });

  // Only members of the workspace may use it (row level security hides others).
  const { data: ws } = await supabase.from('workspaces').select('id').eq('id', workspaceId).maybeSingle();
  if (!ws) return Response.json({ error: 'Not your workspace.' }, { status: 403 });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1500,
      tools: [{ name: 'save_block', description: 'Save the design as structured content.', input_schema: SCHEMA }],
      tool_choice: { type: 'tool', name: 'save_block' },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
          { type: 'text', text: `This image (${width}×${height}px) is an email content block. Read it and call save_block. Copy every piece of text exactly (fix only ALL-CAPS styling). Measure the photo box in pixels of this image, tight to the photo edges.` },
        ],
      }],
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error('extract-design', res.status, t.slice(0, 500));
    return Response.json({ error: `Claude could not read the design (${res.status}).` }, { status: 502 });
  }
  const out = await res.json();
  const input = out?.content?.find((c: any) => c.type === 'tool_use')?.input;
  if (!input) return Response.json({ error: 'Claude returned no result.' }, { status: 502 });
  return Response.json({ result: input });
}
