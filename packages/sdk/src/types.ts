// ---------------------------------------------------------------------------
// @sluby/sdk - Type definitions
// ---------------------------------------------------------------------------

/** Processing status of a video asset. */
export type VideoAssetStatus = 'created' | 'uploading' | 'processing' | 'ready' | 'failed';

/** Access tier controlling who can view a video. */
export type AccessTier = 'public' | 'private';

// ---------------------------------------------------------------------------
// Core resources
// ---------------------------------------------------------------------------

/** Video asset with associated metadata. */
export interface VideoAsset {
  id: string;
  title: string;
  description: string;
  /** Null until the asset finishes processing. */
  manifestObjectId: string | null;
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
  status: string;
  progressPercent: number;
  fileSize: number;
  uploadedBytes: number;
}

/** Playback information for a video asset. */
export interface PlaybackInfo {
  /**
   * Absolute HLS master manifest URL, resolved against the client's delivery
   * base URL. This is what you hand to the player; the browser fetches the
   * manifest and every segment directly from Sia-backed delivery.
   */
  playbackUrl: string;
  /** The raw server-relative manifest path, before delivery-base resolution. */
  playbackPath: string;
  /** Absolute poster image URL, or null when the asset has no thumbnail. */
  posterUrl: string | null;
  durationMs: number;
  resolution: string;
  accessTier: AccessTier;
}

/** Time-limited signed playback URL for gated content. */
export interface SignedPlaybackInfo {
  /** Absolute signed HLS master manifest URL, resolved against delivery base. */
  signedUrl: string;
  /** The raw server-relative signed path, before delivery-base resolution. */
  signedPath: string;
  /** ISO-8601 timestamp at which the signed URL stops working. */
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

/** Options controlling the TUS file upload behaviour. */
export interface UploadFileOptions {
  /** Chunk size in bytes. Default: 10 MB. */
  chunkSize?: number;
  /** Retry delay sequence in milliseconds. Default: [0, 1000, 3000, 5000]. */
  retryDelays?: number[];
  /** Called periodically with the upload progress percentage (0-100). */
  onProgress?: (percent: number, bytesUploaded: number, bytesTotal: number) => void;
  /** Called once when the upload finishes successfully. */
  onSuccess?: () => void;
  /** Called when an unrecoverable upload error occurs. */
  onError?: (error: Error) => void;
}

/**
 * Awaitable upload handle returned by `uploads.upload`.
 *
 * `await`-ing the handle resolves when the upload completes (or rejects on an
 * unrecoverable error / termination). The control methods let you pause,
 * resume, and abort a resumable upload while it is in flight.
 */
export type UploadHandle = Promise<void> & {
  /** Pause the upload; the partial upload is retained and can be resumed. */
  pause: () => Promise<void>;
  /** Resume a paused upload from where it stopped. */
  resume: () => void;
  /** Abort and terminate the upload permanently (discards server-side state). */
  abort: () => Promise<void>;
  /** Whether the upload is currently paused. */
  readonly isPaused: boolean;
};

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
export interface SlubyConfig {
  /** API key (Bearer token). */
  apiKey: string;
  /** Base URL of the Sluby REST API (e.g. "https://api.sluby.app"). */
  baseUrl: string;
  /**
   * Base URL the browser fetches HLS bytes from directly: the delivery /
   * object gateway, optionally an nginx cache in front of it. Playback URLs
   * are resolved against this so the player retrieves manifests and segments
   * straight from Sia-backed delivery instead of through the REST API.
   *
   * Defaults to `baseUrl` when omitted.
   */
  deliveryBaseUrl?: string;
}

/** Webhook event payload delivered to registered endpoints. */
export interface WebhookEvent {
  event: string;
  timestamp: string;
  data: Record<string, unknown>;
}
