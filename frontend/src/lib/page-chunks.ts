import { createElement, lazy, useState, type ComponentType } from 'react';
import { ROUTES } from './constants';

// the code for each routed page, in one place, so App.tsx can lazy-load it
// and the nav can start the download on hover or focus. import() returns the
// same promise for the same module, so a page fetched early is not fetched
// again when the route renders. a page area adds its own entry here and in
// BY_PATH (or DETAIL_PATHS for a page with an id in its path).
export const PAGE_CHUNKS = {
  overview: () => import('@/pages/studio/DashboardPage'),
  videos: () => import('@/pages/studio/AssetsPage'),
  video: () => import('@/pages/studio/AssetDetailPage'),
  upload: () => import('@/pages/studio/UploadPage'),
  quickstart: () => import('@/pages/studio/developers/QuickstartPage'),
  apiKeys: () => import('@/pages/studio/developers/KeysPage'),
  webhooks: () => import('@/pages/studio/developers/WebhooksPage'),
  webhook: () => import('@/pages/studio/developers/WebhookDetailPage'),
  explorer: () => import('@/pages/studio/developers/ExplorerPage'),
  health: () => import('@/pages/studio/deployment/HealthPage'),
  metrics: () => import('@/pages/studio/deployment/MetricsPage'),
  settings: () => import('@/pages/studio/SettingsPage'),
  notFound: () => import('@/pages/NotFoundPage'),
} as const;

export type PageChunk = keyof typeof PAGE_CHUNKS;

const BY_PATH: Record<string, PageChunk> = {
  [ROUTES.OVERVIEW]: 'overview',
  [ROUTES.VIDEOS]: 'videos',
  // looked up before DETAIL_PATHS, which would read "upload" as a video id
  [ROUTES.UPLOAD]: 'upload',
  [ROUTES.DEVELOPERS]: 'quickstart',
  [ROUTES.API_KEYS]: 'apiKeys',
  [ROUTES.WEBHOOKS]: 'webhooks',
  [ROUTES.EXPLORER]: 'explorer',
  [ROUTES.DEPLOYMENT]: 'health',
  [ROUTES.METRICS]: 'metrics',
  [ROUTES.SETTINGS]: 'settings',
};

const DETAIL_PATHS: Array<[RegExp, PageChunk]> = [
  [/^\/studio\/videos\/[^/]+$/, 'video'],
  [/^\/studio\/developers\/webhooks\/[^/]+$/, 'webhook'],
];

/**
 * Starts loading a page's code before the click, so most navigations never
 * show a skeleton. Call it on pointer enter and focus of a link. A failed
 * download is not reported here: the route's lazy import gets the same
 * failure when the page renders, and the error boundary handles it there.
 */
export function preloadPage(path: string): void {
  const name = chunkFor(path);
  if (name) loadPage(PAGE_CHUNKS[name]).catch(() => {});
}

type PageLoader = () => Promise<{ default: ComponentType }>;

const loadedPages = new WeakMap<PageLoader, ComponentType>();

/** Loads a page's code and remembers it, so the page can render without suspending. */
export function loadPage(load: PageLoader) {
  return load().then((mod) => {
    loadedPages.set(load, mod.default);
    return mod;
  });
}

/**
 * lazy() for a routed page that renders at once when its code is already
 * here (preloaded on hover, or at startup for the first page). A plain
 * lazy() suspends once even then, and react holds a fallback it revealed
 * for 300 ms, so the page and its requests would start that much later.
 */
export function lazyPage(load: PageLoader): ComponentType {
  const Lazy = lazy(() => loadPage(load));
  return function LazyPage() {
    // chosen once per mount: switching from Lazy to the loaded component
    // later would remount the page and drop its state
    const [Page] = useState<ComponentType>(() => loadedPages.get(load) ?? Lazy);
    return createElement(Page);
  };
}

/** Which page's code serves a path, if a studio page does. Search and hash are ignored. */
export function chunkFor(path: string): PageChunk | undefined {
  const pathname = path.replace(/[?#].*$/, '');
  const trimmed = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return BY_PATH[trimmed] ?? DETAIL_PATHS.find(([re]) => re.test(trimmed))?.[1];
}
