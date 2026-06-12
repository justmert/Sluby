// ---------------------------------------------------------------------------
// @siastream/sdk - Package entry point
// ---------------------------------------------------------------------------

// Primary client
export { SiaStreamClient } from './client.js';
export { SiaStreamClient as default } from './client.js';

// Sub-managers (for advanced typing or standalone use)
export { UploadManager } from './uploads.js';
export { AssetManager } from './assets.js';
export { PlaybackManager } from './playback.js';
export { WebhookManager } from './webhooks.js';

// Error classes
export {
  SiaStreamError,
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
  ListAssetsOptions,
  PaginatedResponse,
  SiaStreamConfig,
  WebhookEvent,
} from './types.js';
