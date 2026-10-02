import { createClient } from '@/lib/supabase/server';
import { askClaude, hasClaude, jsonFrom, MODEL } from '@/lib/anthropic';
import { cleanSpec, DIRECTIONS, FORMATS, systemPrompt, userPrompt, type LibraryItem } from '@/lib/design';

// Mise Studio: one design per call (the page asks for several in parallel, so they
// arrive one by one). Also refines a design ("make the headline bigger") and resizes it.

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET() {
  return Response.json({ enabled: hasClaude(), model: MODEL });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  if (!hasClaude()) return Response.json({ error: 'not_configured' }, { status: 501 });

  const body = await request.json().catch(() => null);
  const ws = String(body?.workspace_id || '');
  const brief = String(body?.brief || '').trim().slice(0, 1500);
  const w = Math.round(Number(body?.size?.w)), h = Math.round(Number(body?.size?.h));
  if (!ws || !brief || !(w >= 50 && w <= 4000 && h >= 50 && h <= 4000)) return Response.json({ error: 'Missing brief or size.' }, { status: 400 });

  // Row level security: these only return what the user can see.
  const [{ data: workspace }, { data: kitRow }, { data: rows }] = await Promise.all([
    supabase.from('workspaces').select('id, name').eq('id', ws).maybeSingle(),
    supabase.from('brand_kits').select('kit').eq('workspace_id', ws).maybeSingle(),
    supabase.from('assets').select('id, kind, name, width, height, pid, price, fields, storage_path, status')
      .eq('workspace_id', ws).in('kind', ['image', 'product', 'logo']).not('storage_path', 'is', null)
      .order('updated_at', { ascending: false }).limit(80),
  ]);
  if (!workspace) return Response.json({ error: 'Workspace not found.' }, { status: 404 });

  const library: LibraryItem[] = (rows || []).filter((r: any) => r.status !== 'draft').map((r: any) => ({
    id: r.id, kind: r.kind, name: r.name, alt: r.fields?.alt || r.fields?.description || undefined, w: r.width, h: r.height, pid: r.pid, price: r.price,
  }));
  const allowed = new Set(library.map((a) => a.id));
  const fmt = FORMATS.find((f) => f.w === w && f.h === h);
  const idx = Math.max(0, Math.min(DIRECTIONS.length - 1, Number(body?.variant) || 0));

  const text = await askClaude([{ type: 'text', text: userPrompt({
    brand: workspace.name, kit: kitRow?.kit || null, library, brief, size: { w, h }, formatHint: fmt?.hint,
    direction: body?.base ? undefined : DIRECTIONS[idx],
    base: body?.base || null, instruction: body?.instruction ? String(body.instruction).slice(0, 500) : null,
  }) }], { system: systemPrompt(), maxTokens: 2500 });
  const spec = cleanSpec(jsonFrom(text), allowed);
  if (!spec) return Response.json({ error: 'Claude didn’t return a design. Try again.' }, { status: 502 });
  return Response.json({ spec, size: { w, h }, model: MODEL });
}

