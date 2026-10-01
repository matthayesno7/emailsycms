// Server-side fetching of URLs people give us (feed images, brand websites).
// Refuses local and private-network addresses, follows redirects, caps size and time.

export function allowedUrl(raw: string) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    const h = u.hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h.includes(':') || h.startsWith('[')) return null;
    return u;
  } catch {
    return null;
  }
}

type Fetched = { buf: Buffer; type: string; url: string } | { error: string };

export async function fetchLimited(raw: string | URL, opts: { accept?: string; maxBytes?: number; timeoutMs?: number; ua?: string; fetchImpl?: typeof fetch } = {}): Promise<Fetched> {
  const url = allowedUrl(String(raw));
  if (!url) return { error: 'Not a public web address' };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 15000);
  try {
    const res = await (opts.fetchImpl || fetch)(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: {
        'user-agent': opts.ua || 'Mozilla/5.0 (compatible; MiseCMS/1.0; +https://emailsy.app)',
        accept: opts.accept || '*/*',
        'accept-language': 'en-GB,en;q=0.9',
      },
    });
    if (res.url && !allowedUrl(res.url)) return { error: 'Redirected to a private address' };
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const max = opts.maxBytes ?? 5 * 1024 * 1024;
    const len = Number(res.headers.get('content-length') || 0);
    if (len > max) return { error: 'Too large' };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > max) return { error: 'Too large' };
    return { buf, type, url: res.url || url.toString() };
  } catch (e: any) {
    return { error: e?.name === 'AbortError' ? 'Timed out' : 'Could not download' };
  } finally {
    clearTimeout(timer);
  }
}

export const IMAGE_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/avif': 'avif', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico' };
