export interface Crumb {
  label: string;
  path?: string;
}

const SECTION_LABELS: Record<string, string> = {
  upload: 'Upload',
  assets: 'Videos',
  player: 'Player',
  developer: 'Developers',
  analytics: 'Analytics',
  settings: 'Settings',
};

const STUDIO: Crumb = { label: 'Overview', path: '/studio' };
const NOT_FOUND: Crumb = { label: 'Not found' };

/**
 * The trail for a path, matching the routes in App.tsx: a path no route
 * serves reads "Not found" rather than echoing its segments. A video page
 * shows the video's title once it is known, or what went wrong loading it.
 */
export function getBreadcrumbs(pathname: string, assetTitle?: string): Crumb[] {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return [];
  if (segments[0] !== 'studio') return [NOT_FOUND];
  const [, section, detail, ...rest] = segments;
  if (!section) return [STUDIO];

  const label = SECTION_LABELS[section];
  if (!label) return [STUDIO, NOT_FOUND];
  const sectionCrumb = { label, path: `/studio/${section}` };
  if (!detail) return [STUDIO, sectionCrumb];
  if (section !== 'assets' || rest.length > 0) return [STUDIO, sectionCrumb, NOT_FOUND];
  return [STUDIO, sectionCrumb, { label: assetTitle || 'Video' }];
}
