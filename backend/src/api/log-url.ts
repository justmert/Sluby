/**
 * Query values safe to keep in logs. Everything else is replaced, because
 * urls carry capabilities: `sig` on signed object urls, `code` and `state` on
 * the sign-in callback, and whatever a future route adds. An allowlist fails
 * safe where a list of secrets would not.
 */
const LOGGABLE_QUERY_KEYS = new Set([
  'limit',
  'cursor',
  'status',
  'search',
  'sort',
  'order',
  'type',
  'expires',
  'expires_in',
  'include_inactive',
  'access_tier',
]);

// the token of an invite or reset link is the whole capability, and it
// travels in the path
const LINK_TOKEN_PATH = /(\/auth\/invites\/)[^/?]+/i;

/**
 * A request url fit for the logs: the path with link tokens redacted, and the
 * query with unknown values redacted.
 */
export function loggableUrl(url: string): string {
  const q = url.indexOf('?');
  const path = (q === -1 ? url : url.slice(0, q)).replace(LINK_TOKEN_PATH, '$1[redacted]');
  if (q === -1) return path;
  const params = new URLSearchParams(url.slice(q + 1));
  const kept: string[] = [];
  for (const [key, value] of params) {
    kept.push(`${key}=${LOGGABLE_QUERY_KEYS.has(key) ? value : '[redacted]'}`);
  }
  return `${path}?${kept.join('&')}`;
}
