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
export { WebhookManager, DEFAULT_WEBHOOK_TOLERANCE_SECONDS } from './webhooks.js';
export type { WebhookHeaders, VerifyRequestOptions } from './webhooks.js';
export { SiaSession, publicShareMapUrl } from './sia-session.js';
export type { SiaDownloadOptions, SiaSessionTransport } from './sia-session.js';

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
  SiaShareSource,
  WebhookEvent,
} from './types.js';
