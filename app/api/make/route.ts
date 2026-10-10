import { safe } from '@/lib/safeRoute';
import { member } from '@/lib/makeAuth';
import { hasImageGen } from '@/lib/imageGen';
import { hasVideoGen } from '@/lib/videoGen';
import { makeImages } from '@/lib/makeMedia';

// Create: new photography made in Mise (the right image model for the job), saved as drafts.
export const runtime = 'nodejs';
export const maxDuration = 120;

export async function GET() {
  return Response.json({ image: hasImageGen(), video: hasVideoGen() });
}

export const POST = safe('make', async (request: Request) => {
  const body = await request.json().catch(() => null);
  const m = await member(String(body?.workspace_id || ''));
  if ('error' in m) return m.error;
  const r = await makeImages(m.repo, m.db, {
    wsId: String(body.workspace_id), userId: m.user.id, prompt: String(body?.prompt || ''),
    referenceIds: Array.isArray(body?.reference_ids) ? body.reference_ids.map(String) : [],
    aspect: body?.aspect, purpose: body?.purpose, count: body?.count, name: body?.name, onBoard: !!body?.board,
  });
  if ('error' in r) return Response.json({ error: r.error, code: r.code }, { status: r.status });
  return Response.json({ model: r.model, purpose: r.purpose, designs: r.designs, assets: r.assets.map((a) => ({ id: a.row.id, name: a.row.name, url: a.url, width: a.row.width, height: a.row.height })) });
});
