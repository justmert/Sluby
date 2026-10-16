import { NAV_GROUPS, ROUTES } from '@/lib/constants';
import { LEGACY_PATHS } from '@/lib/redirects';

export interface Crumb {
  label: string;
  path?: string;
}

const OVERVIEW: Crumb = { label: 'Overview', path: ROUTES.OVERVIEW };
const UPLOAD: Crumb = { label: 'Upload' };
const NOT_FOUND: Crumb = { label: 'Not found' };

// every page in the nav, by path; the overview is the root crumb itself
const PAGES: Crumb[] = NAV_GROUPS.flatMap((g) => g.items)
  .filter((item) => item.path !== ROUTES.OVERVIEW)
  .map((item) => ({ label: item.label, path: item.path }));

/** Pages with an id in the path: the list they belong to, and their name until the record loads. */
const DETAILS: Array<{ parent: string; fallback: string }> = [
  { parent: ROUTES.VIDEOS, fallback: 'Video' },
  { parent: ROUTES.WEBHOOKS, fallback: 'Webhook' },
];

// old urls redirect at once; their trail stays empty instead of reading "Not found"
const LEGACY = LEGACY_PATHS.map((p) => new RegExp(`^${p.replace(/:[^/]+/g, '[^/]+')}$`));

/**
 * The trail for a path, matching the routes in App.tsx: a path no route
 * serves reads "Not found" rather than echoing its segments. A detail page
 * shows the record's name once it is known (`detailTitle`), or what went
 * wrong loading it.
 */
export function getBreadcrumbs(pathname: string, detailTitle?: string): Crumb[] {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (path === '/' || path === '') return [];
  if (path !== ROUTES.OVERVIEW && !path.startsWith(`${ROUTES.OVERVIEW}/`)) return [NOT_FOUND];
  if (path === ROUTES.OVERVIEW) return [OVERVIEW];
  if (LEGACY.some((re) => re.test(path))) return [];

  const page = PAGES.find((p) => p.path === path);
  if (page) return [OVERVIEW, page];
  // below videos like a video page, but not one: "upload" is no video id
  if (path === ROUTES.UPLOAD) {
    return [OVERVIEW, PAGES.find((p) => p.path === ROUTES.VIDEOS)!, UPLOAD];
  }

  for (const { parent, fallback } of DETAILS) {
    const rest = path.startsWith(`${parent}/`) ? path.slice(parent.length + 1) : null;
    if (rest === null) continue;
    const list = PAGES.find((p) => p.path === parent)!;
    if (rest.includes('/')) return [OVERVIEW, list, NOT_FOUND];
    return [OVERVIEW, list, { label: detailTitle || fallback }];
  }

  // below a real page, such as /studio/settings/extra: keep the way back to it
  const above = PAGES.filter((p) => path.startsWith(`${p.path}/`)).sort(
    (a, b) => b.path!.length - a.path!.length,
  )[0];
  return above ? [OVERVIEW, above, NOT_FOUND] : [OVERVIEW, NOT_FOUND];
}
