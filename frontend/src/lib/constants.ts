import {
  ChartColumn,
  Code,
  Compass,
  Heart,
  House,
  Settings,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { Icons } from './icons';

// the code says "asset" where the api does; the url bar is ui, so routes say
// videos (plan D-02). old paths redirect, see lib/redirects.ts
export const ROUTES = {
  OVERVIEW: '/studio',
  VIDEOS: '/studio/videos',
  // static, so the router ranks it above /studio/videos/:id
  UPLOAD: '/studio/videos/upload',
  video: (id: string) => `/studio/videos/${encodeURIComponent(id)}`,
  DEVELOPERS: '/studio/developers',
  API_KEYS: '/studio/developers/keys',
  WEBHOOKS: '/studio/developers/webhooks',
  webhook: (id: string) => `/studio/developers/webhooks/${encodeURIComponent(id)}`,
  EXPLORER: '/studio/developers/explorer',
  DEPLOYMENT: '/studio/deployment',
  METRICS: '/studio/deployment/metrics',
  MEMBERS: '/studio/members',
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

/** `?upload=1` on any route once opened the upload sheet; it now redirects to the upload page. */
export const UPLOAD_PARAM = 'upload';

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  /** Active only on this exact path, not on the paths below it. */
  exact?: boolean;
  /** For admins only, in a group everyone sees. */
  adminOnly?: boolean;
}

export interface NavGroup {
  id: 'main' | 'developers' | 'deployment' | 'settings';
  /** Shown above the group; the first and last groups have none. */
  label?: string;
  /** Deployment-wide views. The server refuses them to members, so members never see the group. */
  adminOnly?: boolean;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'main',
    items: [
      { label: 'Overview', path: ROUTES.OVERVIEW, icon: House, exact: true },
      { label: 'Videos', path: ROUTES.VIDEOS, icon: Icons.video },
    ],
  },
  {
    id: 'developers',
    label: 'Developers',
    items: [
      { label: 'Quickstart', path: ROUTES.DEVELOPERS, icon: Code, exact: true },
      { label: 'API keys', path: ROUTES.API_KEYS, icon: Icons.apiKey },
      { label: 'Webhooks', path: ROUTES.WEBHOOKS, icon: Icons.webhook },
      { label: 'API explorer', path: ROUTES.EXPLORER, icon: Compass },
    ],
  },
  {
    id: 'deployment',
    label: 'Deployment',
    adminOnly: true,
    items: [
      { label: 'Health', path: ROUTES.DEPLOYMENT, icon: Heart, exact: true },
      { label: 'Metrics', path: ROUTES.METRICS, icon: ChartColumn },
    ],
  },
  {
    id: 'settings',
    items: [
      { label: 'Members', path: ROUTES.MEMBERS, icon: Users, adminOnly: true },
      { label: 'Settings', path: ROUTES.SETTINGS, icon: Settings },
    ],
  },
];

/** The groups a session may see. */
export function navGroupsFor(admin: boolean): NavGroup[] {
  if (admin) return NAV_GROUPS;
  return NAV_GROUPS.filter((g) => !g.adminOnly).map((g) => ({
    ...g,
    items: g.items.filter((item) => !item.adminOnly),
  }));
}

/** Every nav item a session may see, in order. */
export function navItemsFor(admin: boolean): NavItem[] {
  return navGroupsFor(admin).flatMap((g) => g.items);
}

/** Whether a nav item is the current page for `pathname`. */
export function isNavActive(item: NavItem, pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (item.exact) return path === item.path;
  return path === item.path || path.startsWith(`${item.path}/`);
}
