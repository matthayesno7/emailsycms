import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { HELP_ARTICLES } from '@/lib/helpArticles';
import { TAG_MODEL } from '@/lib/autotag';
import { planOf } from '@/lib/billing';
import { roleLabel } from '@/lib/roles';

// Ask Mise: answers a question from the help centre articles (and nothing else), so people can
// help themselves. Signed-in people only; a few questions a minute each.
export const runtime = 'nodejs';
export const maxDuration = 60;

const HELP_TEXT = HELP_ARTICLES.map((a) => `<article url="/help/${a.slug}" title="${a.title}">\n${a.body}\n</article>`).join('\n\n');
const RULES = `You are the help assistant inside Mise, a brand asset library app. Answer the person's question using ONLY the help centre articles provided.
- Be brief and practical: the steps, with the exact button and page names in bold. A few sentences or a short numbered list.
- Link the most relevant article(s) as Markdown links using their url, e.g. [Products](/help/products) or [columns](/help/products#columns-mise-reads). Anchors are the heading in lowercase with dashes.
- Use what you're told about their plan and role: if something they ask about isn't on their plan or role, say so and what to do.
- If the articles don't answer it, say plainly that you're not sure, suggest the closest article, and say they can send the question through **Feedback** at the bottom of the sidebar. Never guess or invent features, prices, limits or steps.
- Only answer questions about Mise. Politely decline anything else.
- UK English. No preamble like "Great question".`;

const recent = new Map<string, number[]>();
function tooMany(user: string) {
  const now = Date.now();
  const list = (recent.get(user) || []).filter((t) => now - t < 60_000);
  list.push(now);
  recent.set(user, list);
  return list.length > 6;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return Response.json({ error: 'Ask isn’t available right now. Browse the help centre instead.' }, { status: 501 });
  if (tooMany(user.id)) return Response.json({ error: 'That’s a lot of questions at once. Wait a minute and ask again.' }, { status: 429 });
  const body = await request.json().catch(() => null);
  const question = String(body?.question || '').trim().slice(0, 1000);
  if (question.length < 3) return Response.json({ error: 'Type a question first.' }, { status: 400 });
  const history = (Array.isArray(body?.history) ? body.history : []).slice(-4)
    .filter((h: any) => typeof h?.q === 'string' && typeof h?.a === 'string')
    .flatMap((h: any) => [{ role: 'user', content: h.q.slice(0, 1000) }, { role: 'assistant', content: h.a.slice(0, 3000) }]);

  // Who's asking: their plan and role in the brand they're in, so answers fit.
  let context = 'Plan and role: unknown.';
  const ws = String(body?.workspace_id || '');
  if (ws) {
    const { data: m } = await supabase.from('workspace_members').select('role, workspaces(name)').eq('workspace_id', ws).eq('user_id', user.id).maybeSingle();
    if (m) {
      const plan = (await planOf(createAdminClient(), ws).catch(() => ({ plan: 'free' }))).plan;
      context = `They are in the brand "${(m as any).workspaces?.name || 'their brand'}", which is on the ${plan === 'pro' ? 'Pro' : plan === 'enterprise' ? 'Enterprise' : 'Free'} plan. Their role: ${roleLabel(m.role)}.`;
    }
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_HELP_MODEL || TAG_MODEL,
      max_tokens: 700,
      system: [
        { type: 'text', text: RULES },
        { type: 'text', text: `<help_centre>\n${HELP_TEXT}\n</help_centre>`, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: context },
      ],
      messages: [...history, { role: 'user', content: question }],
    }),
  }).catch(() => null);
  if (!res?.ok) {
    console.error('[help] ask', res?.status, await res?.text().catch(() => ''));
    return Response.json({ error: 'Couldn’t get an answer just now. Try again, or browse the help centre.' }, { status: 502 });
  }
  const out = await res.json().catch(() => null);
  const answer = String(out?.content?.find((c: any) => c.type === 'text')?.text || '').trim();
  if (!answer) return Response.json({ error: 'Couldn’t get an answer just now. Try again.' }, { status: 502 });
  return Response.json({ answer });
}
