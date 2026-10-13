// ---------------------------------------------------------------------------
// @sluby/sdk - Package entry point
// ---------------------------------------------------------------------------

// Primary client
export { SlubyClient } from './client.js';

// Sub-managers (for advanced typing or standalone use)
export { UploadManager } from './uploads.js';
export type { UploadOptions, AssetUploadHandle } from './uploads.js';
export { AssetManager } from './assets.js';
export { PlaybackManager } from './playback.js';
export { WebhookManager } from './webhooks.js';
export { SiaSession } from './sia-session.js';
export type { SiaDownloadOptions } from './sia-session.js';

// Error classes
export {
  SlubyError,
  AuthenticationError,
  NotFoundError,
  RateLimitError,
  TimeoutError,
} from './errors.js';

// All type definitions
export type {
  VideoAsset,
  VideoAssetStatus,
  AccessTier,
  UploadSession,
  ProcessingJob,
  ProcessingStage,
  PlaybackInfo,
  SignedPlaybackInfo,
  WebhookEndpoint,
  ApiKey,
  UploadFileOptions,
  UploadHandle,
  ListAssetsOptions,
  AssetSortField,
  PaginatedResponse,
  SlubyConfig,
  SiaViewerConfig,
  SiaShareMap,
  WebhookEvent,
} from './types.js';
