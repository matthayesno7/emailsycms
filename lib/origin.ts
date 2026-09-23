// Public origin of the app. Behind Railway's proxy, request.url is the internal
// address (e.g. http://localhost:8080), so prefer the forwarded host, then the
// configured app URL.
export function publicOrigin(request: Request) {
  const h = request.headers;
  const host = h.get('x-forwarded-host') || h.get('host');
  const proto = h.get('x-forwarded-proto') || 'https';
  if (host && !/^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/.test(host)) return `${proto.split(',')[0]}://${host.split(',')[0]}`;
  const configured = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/$/, '');
  return configured || new URL(request.url).origin;
}
