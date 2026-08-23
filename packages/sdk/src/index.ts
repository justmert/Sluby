// ---------------------------------------------------------------------------
// @sluby/sdk - Package entry point
// ---------------------------------------------------------------------------

// Primary client
export { SlubyClient } from './client.js';

// Sub-managers (for advanced typing or standalone use)
export { UploadManager } from './uploads.js';
export { AssetManager } from './assets.js';
export { PlaybackManager } from './playback.js';
export { WebhookManager } from './webhooks.js';

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
  PlaybackInfo,
  SignedPlaybackInfo,
  WebhookEndpoint,
  ApiKey,
  CreateUploadOptions,
  CreateUploadResult,
  UploadFileOptions,
  UploadHandle,
  ListAssetsOptions,
  PaginatedResponse,
  SlubyConfig,
  WebhookEvent,
} from './types.js';
