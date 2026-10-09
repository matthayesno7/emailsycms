// The sites allowed to embed the Mise picker. Shared by server and browser (no secrets here).

// The sites allowed to embed the picker, as origin patterns: "https://app.exponea.com" or
// "https://*.bloomreach.com" (every subdomain). What people type is tidied up; https only, except
// http://localhost for testing. null when it isn't a site.
export function normaliseSite(input: string): string | null {
  let s = input.trim().toLowerCase().replace(/\/+$/, '');
  if (!s) return null;
  // No scheme: https, except local testing addresses, which run on http.
  if (!/^https?:\/\//.test(s)) s = `${/^(localhost|127\.0\.0\.1)(:|$)/.test(s) ? 'http' : 'https'}://${s}`;
  const m = s.match(/^(https?):\/\/(\*\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*)(:\d{1,5})?(?:\/.*)?$/);
  if (!m) return null;
  const [, scheme, star = '', host, port = ''] = m;
  const local = host === 'localhost' || host === '127.0.0.1';
  if (scheme === 'http' && !local) return null;
  if (!local && !/\.[a-z]{2,}$/.test(host)) return null;
  return `${scheme}://${star}${host}${port}`;
}

// Is a page's origin one of the allowed sites? A "*." pattern matches subdomains (as in a browser's
// Content-Security-Policy), not the bare domain: add both if both are used.
export function originAllowed(origin: string | null | undefined, sites: string[]) {
  let o: URL;
  try { o = new URL(origin || ''); } catch { return false; }
  const want = `${o.protocol}//${o.host}`.toLowerCase();
  return sites.some((p) => {
    const m = p.match(/^(https?:\/\/)\*\.(.+)$/);
    if (!m) return p === want;
    return want.startsWith(m[1]) && want.slice(m[1].length).endsWith(`.${m[2]}`);
  });
}
