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

// API endpoints
export const API = {
  HEALTH: '/health',
  METRICS: '/api/v1/metrics',
  CACHE_STATS: '/api/v1/cache-stats',
  PROMETHEUS: '/metrics',
  ASSETS: '/api/v1/assets',
  UPLOADS: '/api/v1/uploads',
  PLAYBACK: '/api/v1/playback',
  KEYS: '/api/v1/keys',
  WEBHOOKS: '/api/v1/webhooks',
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

// Processing steps
export const PROCESSING_STEPS = [
  'Created',
  'Uploading',
  'Processing',
  'Ready',
] as const;

// Rendition presets
export const RENDITION_PRESETS = [
  { label: '1080p', width: 1920, height: 1080, bitrate: '5000k' },
  { label: '720p', width: 1280, height: 720, bitrate: '2500k' },
  { label: '540p', width: 960, height: 540, bitrate: '1500k' },
  { label: '360p', width: 640, height: 360, bitrate: '800k' },
] as const;

// Access tier labels
export const ACCESS_TIER_LABELS = {
  public: 'Public',
  private: 'Private',
} as const;

// Status labels
export const STATUS_LABELS = {
  created: 'Created',
  uploading: 'Uploading',
  processing: 'Processing',
  ready: 'Ready',
  failed: 'Failed',
} as const;

// Webhook event types
export const WEBHOOK_EVENTS = [
  'upload.started',
  'upload.completed',
  'upload.failed',
  'processing.started',
  'processing.progress',
  'asset.ready',
  'asset.errored',
] as const;

// Sia renterd URL
export const SIA_RENTERD_URL =
  import.meta.env.VITE_SIA_RENTERD_URL || 'http://localhost:9980';
