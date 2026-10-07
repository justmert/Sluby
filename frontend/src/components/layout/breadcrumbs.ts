export interface Crumb {
  label: string;
  path?: string;
}

const SECTION_LABELS: Record<string, string> = {
  upload: 'Upload',
  assets: 'Assets',
  player: 'Player',
  developer: 'Developer',
  analytics: 'Analytics',
  settings: 'Settings',
};

const STUDIO: Crumb = { label: 'Studio', path: '/studio' };
const NOT_FOUND: Crumb = { label: 'Not found' };

/**
 * The trail for a path, matching the routes in App.tsx: a path no route
 * serves reads "Not found" rather than echoing its segments. An asset page
 * shows the asset's title once it is known.
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
  return [STUDIO, sectionCrumb, { label: assetTitle || 'Asset' }];
}
