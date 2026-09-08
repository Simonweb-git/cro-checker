const TRACKING_PARAMS = /^(utm_|gclid|fbclid|mc_|_hs|ref$|source$)/i;

/** Canonical form used for dedupe: no fragment, no tracking params, no trailing slash, lowercase host. */
export function normalizeUrl(raw: string, base?: string): string | null {
  let url: URL;
  try {
    url = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.hash = '';
  url.hostname = url.hostname.toLowerCase();
  const params = [...url.searchParams.keys()];
  for (const key of params) if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  url.search = url.searchParams.toString() ? `?${url.searchParams.toString()}` : '';
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) url.pathname = url.pathname.slice(0, -1);
  return url.toString();
}

/** Same page modulo www and trailing slash. */
export function isSameUrl(a: string, b: string): boolean {
  const na = normalizeUrl(a);
  const nb = normalizeUrl(b);
  if (!na || !nb) return false;
  return na.replace('://www.', '://') === nb.replace('://www.', '://');
}
