import { useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'react-router';
import type { VideoAsset } from '@sluby/sdk';
import { statusOf } from '@/lib/api-client';
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
    () => {
      if (!assetId) return undefined;
      const key = ['assets', 'one', assetId];
      const loaded = client.getQueryData<VideoAsset>(key)?.title;
      if (loaded) return loaded;
      const error = client.getQueryState(key)?.error;
      if (!error) return undefined;
      // a malformed id answers 400; both mean there is no such video
      const status = statusOf(error);
      return status === 404 || status === 400 ? 'Video not found' : 'Could not load video';
    },
  );
  return getBreadcrumbs(pathname, title);
}

/** What the browser tab says for a trail: the page's own name, then the app. */
export function routeTitle(crumbs: Crumb[]): string {
  const last = crumbs.at(-1);
  const page = last?.label ?? 'Overview';
  return `${page} · Sluby Studio`;
}
