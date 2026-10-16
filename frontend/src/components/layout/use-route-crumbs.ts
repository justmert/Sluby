import { useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router';
import type { VideoAsset } from '@sluby/sdk';
import { getBreadcrumbs, type Crumb } from './breadcrumbs';

const ASSET_PATH = /^\/studio\/assets\/([^/]+)\/?$/;

/**
 * The breadcrumb trail for the current route. An asset page's crumb uses the
 * title the page loaded. It reads the cache directly rather than through a
 * query observer, so it never fetches and never touches the page's query
 * options.
 */
export function useRouteCrumbs(): Crumb[] {
  const { pathname } = useLocation();
  const client = useQueryClient();
  const assetId = ASSET_PATH.exec(pathname)?.[1];
  const title = useSyncExternalStore(
    (onChange) => client.getQueryCache().subscribe(onChange),
    () =>
      assetId ? client.getQueryData<VideoAsset>(['assets', 'one', assetId])?.title : undefined,
  );
  return getBreadcrumbs(pathname, title);
}

/** What the browser tab says for a trail: the page's own name, then the app. */
export function routeTitle(crumbs: Crumb[]): string {
  const last = crumbs.at(-1);
  // the studio root is the dashboard
  const page = !last || (crumbs.length === 1 && last.path === '/studio') ? 'Dashboard' : last.label;
  return `${page} · Sluby Studio`;
}
