// Minimal Claude API client for server routes. Optional: without ANTHROPIC_API_KEY
// the features that use it fall back or turn off.

export const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';

export function hasClaude() {
  return !!process.env.ANTHROPIC_API_KEY;
}

export async function askClaude(content: any[], opts: { maxTokens?: number; system?: string } = {}): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: opts.maxTokens ?? 1024, ...(opts.system ? { system: opts.system } : {}), messages: [{ role: 'user', content }] }),
  });
  if (!res.ok) return null;
  const out = await res.json().catch(() => null);
  return String(out?.content?.find((c: any) => c.type === 'text')?.text || '') || null;
}

// The first JSON object in a reply (Claude sometimes wraps it in a code fence).
export function jsonFrom(text: string | null): any {
  if (!text) return null;
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch { return null; }
}
