import { ROUTES } from './constants';

// the code for each routed page, in one place, so App.tsx can lazy-load it
// and the nav can start the download on hover or focus. import() returns the
// same promise for the same module, so a page fetched early is not fetched
// again when the route renders.
export const PAGE_CHUNKS = {
  dashboard: () => import('@/pages/studio/DashboardPage'),
  upload: () => import('@/pages/studio/UploadPage'),
  assets: () => import('@/pages/studio/AssetsPage'),
  assetDetail: () => import('@/pages/studio/AssetDetailPage'),
  player: () => import('@/pages/studio/PlayerPage'),
  developer: () => import('@/pages/studio/DeveloperPage'),
  analytics: () => import('@/pages/studio/AnalyticsPage'),
  settings: () => import('@/pages/studio/SettingsPage'),
  notFound: () => import('@/pages/NotFoundPage'),
} as const;

const BY_PATH: Record<string, keyof typeof PAGE_CHUNKS> = {
  [ROUTES.STUDIO_DASHBOARD]: 'dashboard',
  [ROUTES.STUDIO_UPLOAD]: 'upload',
  [ROUTES.STUDIO_ASSETS]: 'assets',
  [ROUTES.STUDIO_PLAYER]: 'player',
  [ROUTES.STUDIO_DEVELOPER]: 'developer',
  [ROUTES.STUDIO_ANALYTICS]: 'analytics',
  [ROUTES.STUDIO_SETTINGS]: 'settings',
};

/**
 * Starts loading a page's code before the click, so most navigations never
 * show a skeleton. Call it on pointer enter and focus of a link. A failed
 * download is not reported here: the route's lazy import gets the same
 * failure when the page renders, and the error boundary handles it there.
 */
export function preloadPage(path: string): void {
  const name = chunkFor(path);
  if (name) PAGE_CHUNKS[name]().catch(() => {});
}

/** Which page's code serves a path, if a studio page does. */
export function chunkFor(path: string): keyof typeof PAGE_CHUNKS | undefined {
  return /^\/studio\/assets\/[^/]+\/?$/.test(path) ? 'assetDetail' : BY_PATH[path];
}
