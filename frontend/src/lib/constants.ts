import {
  Activity,
  BookOpen,
  ChartLine,
  Compass,
  Film,
  KeyRound,
  LayoutDashboard,
  Settings,
  Webhook,
  type LucideIcon,
} from 'lucide-react';

// the code says "asset" where the api does; the url bar is ui, so routes say
// videos (plan D-02). old paths redirect, see lib/redirects.ts
export const ROUTES = {
  OVERVIEW: '/studio',
  VIDEOS: '/studio/videos',
  video: (id: string) => `/studio/videos/${encodeURIComponent(id)}`,
  DEVELOPERS: '/studio/developers',
  API_KEYS: '/studio/developers/keys',
  WEBHOOKS: '/studio/developers/webhooks',
  webhook: (id: string) => `/studio/developers/webhooks/${encodeURIComponent(id)}`,
  EXPLORER: '/studio/developers/explorer',
  DEPLOYMENT: '/studio/deployment',
  METRICS: '/studio/deployment/metrics',
  SETTINGS: '/studio/settings',
} as const;

/** Places outside the studio that it links to. */
export const LINKS = {
  /** The server's own OpenAPI reference. */
  API_REFERENCE: '/api/v1/docs',
  SOURCE: 'https://github.com/justmert/Sluby',
  /** How to turn sign-in on, for the warning a server with AUTH_DISABLED shows. */
  SIGN_IN_SETUP: 'https://github.com/justmert/Sluby/blob/main/docs/guide/configuration.md#sign-in',
} as const;

/** `?upload=1` on any route opens the upload sheet (lib/upload-sheet.ts). */
export const UPLOAD_PARAM = 'upload';

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  /** Active only on this exact path, not on the paths below it. */
  exact?: boolean;
}

export interface NavGroup {
  id: 'main' | 'developers' | 'deployment' | 'settings';
  /** Shown above the group; the first and last groups have none. */
  label?: string;
  /** Deployment-wide views. The server refuses them to members, so members never see the group. */
  operatorOnly?: boolean;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'main',
    items: [
      { label: 'Overview', path: ROUTES.OVERVIEW, icon: LayoutDashboard, exact: true },
      { label: 'Videos', path: ROUTES.VIDEOS, icon: Film },
    ],
  },
  {
    id: 'developers',
    label: 'Developers',
    items: [
      { label: 'Quickstart', path: ROUTES.DEVELOPERS, icon: BookOpen, exact: true },
      { label: 'API keys', path: ROUTES.API_KEYS, icon: KeyRound },
      { label: 'Webhooks', path: ROUTES.WEBHOOKS, icon: Webhook },
      { label: 'API explorer', path: ROUTES.EXPLORER, icon: Compass },
    ],
  },
  {
    id: 'deployment',
    label: 'Deployment',
    operatorOnly: true,
    items: [
      { label: 'Health', path: ROUTES.DEPLOYMENT, icon: Activity, exact: true },
      { label: 'Metrics', path: ROUTES.METRICS, icon: ChartLine },
    ],
  },
  {
    id: 'settings',
    items: [{ label: 'Settings', path: ROUTES.SETTINGS, icon: Settings }],
  },
];

/** The groups a session may see. */
export function navGroupsFor(operator: boolean): NavGroup[] {
  return NAV_GROUPS.filter((g) => operator || !g.operatorOnly);
}

/** Every nav item a session may see, in order. */
export function navItemsFor(operator: boolean): NavItem[] {
  return navGroupsFor(operator).flatMap((g) => g.items);
}

/** Whether a nav item is the current page for `pathname`. */
export function isNavActive(item: NavItem, pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (item.exact) return path === item.path;
  return path === item.path || path.startsWith(`${item.path}/`);
}
