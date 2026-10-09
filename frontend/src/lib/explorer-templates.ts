// requests the api explorer can prefill; every path is a mounted route
// (checked against the openapi document in the backend's drift test)

export interface RequestTemplate {
  label: string;
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: string;
  group: string;
}

const json = (v: unknown) => JSON.stringify(v, null, 2);

export const REQUEST_TEMPLATES: RequestTemplate[] = [
  { group: 'Assets', label: 'List assets', method: 'GET', path: '/api/v1/assets?limit=20' },
  {
    group: 'Assets',
    label: 'Search ready assets',
    method: 'GET',
    path: '/api/v1/assets?search=demo&status=ready&sort=title&order=asc',
  },
  { group: 'Assets', label: 'Get asset', method: 'GET', path: '/api/v1/assets/{id}' },
  {
    group: 'Assets',
    label: 'Update asset',
    method: 'PATCH',
    path: '/api/v1/assets/{id}',
    body: json({ title: 'New title', access_tier: 'public' }),
  },
  {
    group: 'Assets',
    label: 'Processing status',
    method: 'GET',
    path: '/api/v1/assets/{id}/processing',
  },
  { group: 'Assets', label: 'Retry processing', method: 'POST', path: '/api/v1/assets/{id}/retry' },
  { group: 'Assets', label: 'Renditions', method: 'GET', path: '/api/v1/assets/{id}/renditions' },
  {
    group: 'Assets',
    label: 'Sia storage breakdown',
    method: 'GET',
    path: '/api/v1/assets/{id}/sia',
  },
  { group: 'Assets', label: 'Delete asset', method: 'DELETE', path: '/api/v1/assets/{id}' },
  { group: 'Playback', label: 'Playback URL', method: 'GET', path: '/api/v1/playback/{id}' },
  {
    group: 'Playback',
    label: 'Signed URL',
    method: 'GET',
    path: '/api/v1/playback/{id}/signed?expires_in=3600',
  },
  { group: 'Playback', label: 'Sia share map', method: 'GET', path: '/api/v1/playback/{id}/share' },
  { group: 'Account', label: 'Library stats', method: 'GET', path: '/api/v1/stats' },
  { group: 'Account', label: 'System status', method: 'GET', path: '/api/v1/system/status' },
  { group: 'Account', label: 'List API keys', method: 'GET', path: '/api/v1/keys' },
  { group: 'Account', label: 'List webhooks', method: 'GET', path: '/api/v1/webhooks' },
];

export type Method = RequestTemplate['method'];

/** How long an explorer request may run before it gives up. */
export const EXPLORER_TIMEOUT_MS = 30_000;

export const METHODS: Method[] = ['GET', 'POST', 'PATCH', 'DELETE'];

/**
 * Whether a request changes real data enough to ask first: every DELETE, and
 * writes to videos, keys and webhooks (FLW-18).
 */
export function needsConfirm(method: Method, path: string): boolean {
  if (method === 'DELETE') return true;
  if (method === 'GET') return false;
  const route = path.split('?')[0];
  return /^\/api\/v1\/(assets|keys|webhooks)(\/|$)/.test(route);
}

/** Why a path cannot be sent yet, or null when it can. */
export function pathProblem(path: string): string | null {
  // a path on this origin only; "//host/..." would be another site
  if (!path.startsWith('/') || path.startsWith('//')) {
    return 'Start the path with /, for example /api/v1/assets.';
  }
  if (path.includes('{id}')) return 'Replace {id} with a real ID first.';
  return null;
}
