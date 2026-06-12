// ---------------------------------------------------------------------------
// @siastream/sdk - Type definitions
// ---------------------------------------------------------------------------

/** Processing status of a video asset. */
export type VideoAssetStatus =
  | 'created'
  | 'uploading'
  | 'processing'
  | 'ready'
  | 'failed';

/** Access tier controlling who can view a video. */
export type AccessTier =
  | 'public'
  | 'private'
  | 'pay_per_view'
  | 'subscription';

// ---------------------------------------------------------------------------
// Core resources
// ---------------------------------------------------------------------------

/** Video asset with associated metadata. */
export interface VideoAsset {
  id: string;
  title: string;
  description: string;
  manifestObjectId: string;
  thumbnailObjectIds: string[];
  durationMs: number;
  resolution: string;
  status: VideoAssetStatus;
  accessTier: AccessTier;
  creatorAddress: string;
  segmentCount: number;
  totalStorageBytes: number;
  createdAt: string;
  updatedAt: string;
}

/** Upload session tracking TUS upload progress. */
export interface UploadSession {
  id: string;
  videoAssetId: string;
  uploadUrl: string;
  status: string;
  progressPercent: number;
  fileSize: number;
  uploadedBytes: number;
}

/** Playback information for a video asset. */
export interface PlaybackInfo {
  playbackUrl: string;
  posterUrl: string;
  durationMs: number;
  resolution: string;
  accessTier: AccessTier;
}

/** Time-limited signed playback URL for gated content. */
export interface SignedPlaybackInfo {
  signedUrl: string;
  expiresAt: string;
}

/** Registered webhook endpoint. */
export interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  createdAt: string;
}

/** Developer API key. */
export interface ApiKey {
  id: string;
  name: string;
  scopes: string[];
  rateLimit: number;
  isActive: boolean;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Request / option types
// ---------------------------------------------------------------------------

/** Options for creating a new video upload session. */
export interface CreateUploadOptions {
  title: string;
  description: string;
  accessTier: AccessTier;
}

/** Result of creating a new upload. */
export interface CreateUploadResult {
  videoAssetId: string;
  uploadUrl: string;
}

/** Options controlling the TUS file upload behaviour. */
export interface UploadFileOptions {
  /** Chunk size in bytes. Default: 10 MB. */
  chunkSize?: number;
  /** Number of parallel chunk uploads (tus-js-client parallelUploads). Default: 3. */
  parallelUploads?: number;
  /** Retry delay sequence in milliseconds. Default: [0, 1000, 3000, 5000]. */
  retryDelays?: number[];
  /** Called periodically with the upload progress percentage (0-100). */
  onProgress?: (percent: number) => void;
  /** Called when an unrecoverable upload error occurs. */
  onError?: (error: Error) => void;
}

/** Options for listing video assets. */
export interface ListAssetsOptions {
  page?: number;
  limit?: number;
  status?: VideoAssetStatus;
  accessTier?: AccessTier;
}

/** Paginated response wrapper. */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

/** SDK client configuration. */
export interface SiaStreamConfig {
  /** API key (Bearer token). */
  apiKey: string;
  /** Base URL of the SiaStream API (e.g. "https://api.siastream.io"). */
  baseUrl: string;
}

/** Webhook event payload delivered to registered endpoints. */
export interface WebhookEvent {
  event: string;
  timestamp: string;
  data: Record<string, unknown>;
}
