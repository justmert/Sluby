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

// Route paths
export const ROUTES = {
  STUDIO_DASHBOARD: '/studio',
  STUDIO_UPLOAD: '/studio/upload',
  STUDIO_ASSETS: '/studio/assets',
  STUDIO_ASSET_DETAIL: '/studio/assets/:id',
  STUDIO_PLAYER: '/studio/player',
  STUDIO_DEVELOPER: '/studio/developer',
  STUDIO_ANALYTICS: '/studio/analytics',
  STUDIO_SETTINGS: '/studio/settings',
} as const;

// Navigation items
export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
}

export const STUDIO_NAV: NavItem[] = [
  { label: 'Dashboard', path: ROUTES.STUDIO_DASHBOARD, icon: LayoutDashboard },
  { label: 'Upload', path: ROUTES.STUDIO_UPLOAD, icon: Upload },
  { label: 'Assets', path: ROUTES.STUDIO_ASSETS, icon: Film },
  { label: 'Player', path: ROUTES.STUDIO_PLAYER, icon: Play },
  { label: 'Developer', path: ROUTES.STUDIO_DEVELOPER, icon: Code2 },
  { label: 'Analytics', path: ROUTES.STUDIO_ANALYTICS, icon: BarChart3 },
  { label: 'Settings', path: ROUTES.STUDIO_SETTINGS, icon: Settings },
];
