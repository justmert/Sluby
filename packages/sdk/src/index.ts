// Primary client
export { SlubyClient } from './client.js';

// Sub-managers (for advanced typing or standalone use)
export { UploadManager } from './uploads.js';
export type { UploadOptions, AssetUploadHandle, UploadInput } from './uploads.js';
export { AssetManager, assetEtag } from './assets.js';
export { PlaybackManager } from './playback.js';
export { PlaybackIdManager } from './playback-ids.js';
export { KeyManager } from './keys.js';
export { SessionManager } from './sessions.js';
export { ReconciliationManager } from './reconciliation.js';
export { WebhookEndpointManager } from './webhook-endpoints.js';
export { WebhookManager, DEFAULT_WEBHOOK_TOLERANCE_SECONDS } from './webhooks.js';
export type { WebhookHeaders, VerifyRequestOptions } from './webhooks.js';
export { SiaSession, publicShareMapUrl } from './sia-session.js';
export type { SiaDownloadOptions, SiaObject, SiaSessionTransport } from './sia-session.js';

// Error classes
export {
  SlubyError,
  AuthenticationError,
  PermissionError,
  NotFoundError,
  ConflictError,
  ValidationError,
  RateLimitError,
  TimeoutError,
  AbortError,
  ProcessingFailedError,
} from './errors.js';

// All type definitions
export type {
  VideoAsset,
  VideoAssetStatus,
  AccessTier,
  UploadSession,
  UploadSessionStatus,
  ProcessingJob,
  ProcessingStage,
  RetryStage,
  PlaybackInfo,
  SignedPlaybackInfo,
  UploadFileOptions,
  UploadHandle,
  RequestOptions,
  ListAssetsOptions,
  AssetSortField,
  PaginatedResponse,
  SlubyConfig,
  SiaViewerConfig,
  SiaShareMap,
  SiaShareSource,
  WebhookEvent,
  WebhookEventName,
  Rendition,
  AssetStats,
  PlaybackId,
  PlaybackPolicy,
  CreatePlaybackIdInput,
  ApiKey,
  ApiKeyPage,
  ApiKeyScope,
  CreatedApiKey,
  RotatedApiKey,
  CreateApiKeyInput,
  ListApiKeysOptions,
  CursorPage,
  WebhookEndpoint,
  CreatedWebhookEndpoint,
  CreateWebhookEndpointInput,
  WebhookTestResult,
  WebhookDelivery,
  UpdateWebhookEndpointInput,
  StudioSession,
  UsageReport,
  MissingObject,
  ReconciliationReport,
  ReconciliationReportDeployment,
  ReconciliationReportAccount,
  ReconciliationTrigger,
} from './types.js';
