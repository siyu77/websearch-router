const TRACKING_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref', 'source'];

export function normalizeUrl(input: string): string | null {
  let u: URL;
  try { u = new URL(input); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hostname = u.hostname.toLowerCase();
  for (const p of TRACKING_PARAMS) u.searchParams.delete(p);
  u.hash = '';
  let pathname = u.pathname;
  if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);
  u.pathname = pathname;
  const params = Array.from(u.searchParams.entries()).sort(([a], [b]) => a.localeCompare(b));
  const query = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  return `${u.protocol}//${u.host}${pathname}${query ? '?' + query : ''}`;
}
