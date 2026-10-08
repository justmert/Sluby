import {
  LayoutDashboard,
  Upload,
  Film,
  Play,
  Code2,
  BarChart3,
  Settings,
  type LucideIcon,
} from 'lucide-react';

export const ROUTES = {
  STUDIO_DASHBOARD: '/studio',
  STUDIO_UPLOAD: '/studio/upload',
  STUDIO_ASSETS: '/studio/assets',
  STUDIO_PLAYER: '/studio/player',
  STUDIO_DEVELOPER: '/studio/developer',
  STUDIO_ANALYTICS: '/studio/analytics',
  STUDIO_SETTINGS: '/studio/settings',
} as const;

// nav labels follow the copy glossary (resources/frontend-final-audit/copy.md):
// a video is an "asset" only in the api, so the route keeps /assets while the
// label says Videos
export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  /** Deployment-wide views, for operators; the server refuses them to anyone else. */
  operatorOnly?: boolean;
}

export const STUDIO_NAV: NavItem[] = [
  { label: 'Overview', path: ROUTES.STUDIO_DASHBOARD, icon: LayoutDashboard },
  { label: 'Upload', path: ROUTES.STUDIO_UPLOAD, icon: Upload },
  { label: 'Videos', path: ROUTES.STUDIO_ASSETS, icon: Film },
  { label: 'Player', path: ROUTES.STUDIO_PLAYER, icon: Play },
  { label: 'Developers', path: ROUTES.STUDIO_DEVELOPER, icon: Code2 },
  { label: 'Analytics', path: ROUTES.STUDIO_ANALYTICS, icon: BarChart3, operatorOnly: true },
  { label: 'Settings', path: ROUTES.STUDIO_SETTINGS, icon: Settings },
];
