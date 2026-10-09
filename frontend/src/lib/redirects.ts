import { ROUTES, UPLOAD_PARAM } from './constants';

/** The parts of a location a redirect reads. */
export interface Place {
  pathname: string;
  search: string;
  hash: string;
}

const join = (pathname: string, params: URLSearchParams, hash: string) => {
  const search = params.toString();
  return `${pathname}${search ? `?${search}` : ''}${hash}`;
};

/**
 * Where an old studio url lives now (plan D-03), or null when the path is
 * current. Every redirect keeps the search params and the hash, apart from
 * the ones it consumes. `/studio/settings` itself is current; only its old
 * `?create=key` deep link moved.
 */
export function legacyRedirect(place: Place, { operator }: { operator: boolean }): string | null {
  const path = place.pathname.replace(/\/+$/, '') || '/';
  const params = new URLSearchParams(place.search);
  const { hash } = place;

  if (path === '/studio/assets') return join(ROUTES.VIDEOS, params, hash);
  const asset = /^\/studio\/assets\/([^/]+)$/.exec(path);
  if (asset) return join(ROUTES.video(decodeURIComponent(asset[1])), params, hash);

  if (path === '/studio/upload') {
    params.set(UPLOAD_PARAM, '1');
    return join(ROUTES.VIDEOS, params, hash);
  }

  if (path === '/studio/player') {
    const id = params.get('asset');
    params.delete('asset');
    if (id) return join(ROUTES.video(id), params, hash);
    params.set('status', 'ready');
    return join(ROUTES.VIDEOS, params, hash);
  }

  if (path === '/studio/developer') {
    const to = params.get('create') === 'webhook' ? ROUTES.WEBHOOKS : ROUTES.DEVELOPERS;
    return join(to, params, hash);
  }

  if (path === ROUTES.SETTINGS && params.get('create') === 'key') {
    return join(ROUTES.API_KEYS, params, hash);
  }

  // the server metrics were the only part of analytics a member could not
  // get elsewhere, and members cannot see them (FLW-57)
  if (path === '/studio/analytics') {
    return operator ? join(ROUTES.METRICS, params, hash) : join(ROUTES.OVERVIEW, params, hash);
  }

  return null;
}

/** The old paths, for the route table: each renders a redirect. */
export const LEGACY_PATHS = [
  '/studio/assets',
  '/studio/assets/:id',
  '/studio/upload',
  '/studio/player',
  '/studio/developer',
  '/studio/analytics',
] as const;
