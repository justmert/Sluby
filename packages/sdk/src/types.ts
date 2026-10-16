/** Processing status of a video asset. */
export type VideoAssetStatus = 'created' | 'uploading' | 'processing' | 'ready' | 'failed';

/** Access tier controlling who can view a video. */
export type AccessTier = 'public' | 'private';

/** Video asset with associated metadata. */
export interface VideoAsset {
  id: string;
  title: string;
  description: string;
  /** Null until the asset finishes processing. */
  manifestObjectId: string | null;
  thumbnailObjectIds: string[];
  /** Null or 0 until processing has probed the source. */
  durationMs: number | null;
  /** Source resolution such as `1920x1080`; null or empty until probed. */
  resolution: string | null;
  status: VideoAssetStatus;
  accessTier: AccessTier;
  creatorAddress: string;
  segmentCount: number;
  totalStorageBytes: number;
  /**
   * All-time plays: player loads the server saw, through the gateway or by
   * minting a share map to play direct from Sia. One viewer loading the same
   * video again within 30 minutes counts once, and Studio previews do not
   * count. New plays show up within about 10 seconds.
   */
  playCount: number;
  /** When the newest counted play happened; null before the first. */
  lastPlayedAt: string | null;
  createdAt: string;
  /** Also the asset's version: `assets.update` can send it as If-Match. */
  updatedAt: string;
}

/** Step of the processing pipeline an asset is on. */
export type ProcessingStage =
  'queued' | 'transcode' | 'upload' | 'finalize' | 'completed' | 'failed';

/** Processing job for an asset: transcode to HLS, store on Sia, finalize. */
export interface ProcessingJob {
  id: string;
  /** Job state as the worker records it. `retrying` means a failed attempt is queued again. */
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'retrying';
  stage: ProcessingStage;
  /** Overall pipeline progress, 0-100. */
  progressPercent: number;
  retryCount: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  logs: Array<{ timestamp: string; stage: string; message: string }>;
  /**
   * Whether `assets.retry` can start a new run: true only for a failed asset
   * whose failure was not final (a file that is not a readable video is) and
   * whose transcode output or original file is still on the server.
   */
  retryable: boolean;
}

/** Where an asset's failed processing restarted: the whole run, or only the Sia upload. */
export type RetryStage = 'transcode' | 'upload-segments';

/** State of an upload session. */
export type UploadSessionStatus = 'uploading' | 'completed' | 'cancelled' | 'failed';

/** Upload session tracking TUS upload progress. */
export interface UploadSession {
  id: string;
  /** Null when the session has no asset (it was discarded). */
  videoAssetId: string | null;
  status: UploadSessionStatus;
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
  durationMs: number | null;
  resolution: string | null;
  accessTier: AccessTier;
}

/** Time-limited signed playback URL for gated content. */
export interface SignedPlaybackInfo {
  /** Absolute signed HLS master manifest URL, resolved against delivery base. */
  signedUrl: string;
  /** The raw server-relative signed path, before delivery-base resolution. */
  signedPath: string;
  /**
   * The asset's first thumbnail, signed the same way and until the same time,
   * so a private asset can show a poster. Null when the asset has none.
   */
  posterUrl: string | null;
  /** ISO-8601 timestamp at which the signed URL stops working. */
  expiresAt: string;
}

/** One HLS rendition of a ready asset, as `assets.renditions()` lists it. */
export interface Rendition {
  /** Rung name such as `720p`. */
  name: string;
  width: number | null;
  height: number | null;
  videoBitrateKbps: number | null;
  /** Media segments in this rendition. */
  segmentCount: number;
  /** Bytes of this rendition's media on Sia, before erasure coding. */
  byteSize: number;
  /** Sia object holding the rendition's media. */
  dataObjectId: string;
  /** Sia object holding the rendition's playlist. */
  playlistObjectId: string;
}

/** Library totals from `assets.stats()`. */
export interface AssetStats {
  /** Assets that are not deleted. */
  total: number;
  /** Asset count per status; every status is present, 0 when none. */
  byStatus: Record<VideoAssetStatus, number>;
  /** Bytes stored on Sia for these assets, before erasure coding. */
  storedBytes: number;
  /** Total duration of the ready assets. */
  readyDurationMs: number;
  /** Sia objects backing these assets. */
  objectCount: number;
}

/** A missing object of the storage check, with the video that holds it. */
export interface MissingObject {
  objectId: string;
  /** Null when no live video holds the object any more. */
  videoAssetId: string | null;
  title: string | null;
}

interface ReconciliationReportBase {
  id: string;
  startedAt: string;
  finishedAt: string;
  createdAt: string;
  /** `drift` when objects are missing (for `account`: objects of the caller's videos). */
  status: 'ok' | 'drift' | 'failed';
  missingCount: number;
  /** Tracked by a video, absent from the indexer. */
  missingIds: string[];
  /** `missingIds` in the same order, each with its video. */
  missingObjects: MissingObject[];
}

/** The whole deployment's check, for the platform identity and operators. */
export interface ReconciliationReportDeployment extends ReconciliationReportBase {
  scope: 'deployment';
  dbObjectCount: number;
  indexerObjectCount: number;
  inSyncCount: number;
  orphanCount: number;
  /** Pinned on the indexer, tracked by no video. */
  orphanedIds: string[];
  errorMessage: string | null;
}

/** One account's part of the check: only its own missing objects. */
export interface ReconciliationReportAccount extends ReconciliationReportBase {
  scope: 'account';
}

/** The latest storage check from `reconciliation.latest()`. */
export type ReconciliationReport = ReconciliationReportDeployment | ReconciliationReportAccount;

/** The answer of `reconciliation.run()`. */
export interface ReconciliationTrigger {
  enqueued: boolean;
  /** A check was already waiting or running, so nothing new was queued. */
  alreadyPending: boolean;
}

/** Plays per UTC day from `assets.usage()`. */
export interface UsageReport {
  /** Oldest first, today last; a day without plays has `plays: 0`. */
  days: Array<{ date: string; plays: number }>;
  /** Plays over all the days. */
  total: number;
}

/** Who may play through a playback id: anyone, or only signed URLs. */
export type PlaybackPolicy = 'public' | 'signed';

/** A public, revocable `pb_...` handle for an asset. */
export interface PlaybackId {
  /** The record's id. */
  id: string;
  /** The public `pb_...` handle; use it in place of the asset id in playback URLs. */
  playbackId: string;
  policy: PlaybackPolicy;
  /** Label given at creation; empty when none was. */
  name: string;
  createdAt: string;
}

/** What an API key may do. */
export type ApiKeyScope = 'upload' | 'read' | 'manage';

/** An API key as listed. The secret is never part of it after creation. */
export interface ApiKey {
  id: string;
  name: string;
  scopes: ApiKeyScope[];
  /** Requests per minute. */
  rateLimit: number;
  isActive: boolean;
  createdAt: string;
  /** Set while a rotated-out key is in its grace period; null otherwise. */
  expiresAt: string | null;
  /** The first 12 characters of the key, to tell keys apart; null for keys made before it was stored. */
  prefix: string | null;
  /** When the key last authenticated a request, to the minute; null if never since recorded. */
  lastUsedAt: string | null;
}

/** A page of keys, with the server's limits on keys. */
export interface ApiKeyPage extends CursorPage<ApiKey> {
  limits: {
    /** How many usable keys one account may hold. */
    maxKeys: number;
    /** The highest `rateLimit` a key may have. */
    maxRateLimit: number;
  };
}

/** A newly created key: the listing shape plus the raw secret, shown only here. */
export interface CreatedApiKey extends ApiKey {
  /** The raw `sluby_...` key. Store it now; it cannot be read again. */
  key: string;
}

/** The replacement a rotation issued, with the secret, shown only here. */
export interface RotatedApiKey extends CreatedApiKey {
  /** Id of the key that was rotated out. */
  rotatedFrom: string;
  /** When the rotated-out key stops working. */
  previousKeyExpiresAt: string;
}

/** A registered webhook endpoint as listed. */
export interface WebhookEndpoint {
  id: string;
  url: string;
  events: WebhookEventName[];
  /** False while the endpoint is paused: nothing is sent to it. */
  isActive: boolean;
  createdAt: string;
  /** When the newest delivery attempt was made; null before the first. */
  lastDeliveryAt: string | null;
  /** Whether that attempt got a 2xx answer; null before the first. */
  lastDeliveryOk: boolean | null;
}

/** Fields to change on a webhook endpoint; send at least one. */
export interface UpdateWebhookEndpointInput {
  url?: string;
  /** Replaces the subscribed events. */
  events?: WebhookEventName[];
  /** False pauses the endpoint, true resumes it. */
  isActive?: boolean;
}

/** A newly registered endpoint with its signing secret, shown only here. */
export interface CreatedWebhookEndpoint {
  id: string;
  url: string;
  events: WebhookEventName[];
  /** Secret for `webhooks.verifyRequest`. Store it now; it cannot be read again. */
  secret: string;
}

/** How the receiver answered a `webhook.test` event. */
export interface WebhookTestResult {
  /** True when the receiver answered 2xx. */
  delivered: boolean;
  /** Null when no response came. */
  statusCode: number | null;
  /** Why the delivery failed, or null. */
  error: string | null;
}

/** One delivery attempt to an endpoint. Response bodies are never stored. */
export interface WebhookDelivery {
  id: string;
  /** The event's id, the same on every retry; null for older records. */
  eventId: string | null;
  /** Event name, including `webhook.test` for test sends. */
  event: string;
  statusCode: number | null;
  delivered: boolean;
  error: string | null;
  /** 1 for the first try. */
  attempt: number;
  createdAt: string;
  /** The JSON body that was sent: `{ id, event, timestamp, data }`. */
  payload: Record<string, unknown>;
  /** True for an attempt of a resend made with `webhookEndpoints.redeliver`. */
  manual: boolean;
}

/** A browser signed in to the Studio, from `sessions.list()`. */
export interface StudioSession {
  id: string;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  /** The last request made with it, to within five minutes; null if none since recorded. */
  lastSeenAt: string | null;
  /** The session making the request. */
  current: boolean;
}

/** A page of a list that pages by cursor only. */
export interface CursorPage<T> {
  data: T[];
  /** Whether there is a page after this one. */
  hasMore: boolean;
  /** Pass as `cursor` to get the next page; null on the last page. */
  nextCursor: string | null;
}

/** Options for listing API keys. */
export interface ListApiKeysOptions extends RequestOptions {
  /** Keys per page, 1 to 1000. The server's default is 1000. */
  limit?: number;
  /** The `nextCursor` of the previous page. */
  cursor?: string;
}

/** Fields of a new API key. */
export interface CreateApiKeyInput {
  name: string;
  /** Default `['upload', 'read']`. */
  scopes?: ApiKeyScope[];
  /** Requests per minute. Default 100; the deployment sets the maximum. */
  rateLimit?: number;
}

/** Fields of a new webhook endpoint. */
export interface CreateWebhookEndpointInput {
  /** Absolute http(s) URL whose host resolves to public addresses. */
  url: string;
  /** At least one event. */
  events: WebhookEventName[];
}

/** Fields of a new playback id. */
export interface CreatePlaybackIdInput {
  /** Default `public`. */
  policy?: PlaybackPolicy;
  name?: string;
}

/** Per-call options every request method takes. */
export interface RequestOptions {
  /**
   * Cancels the request. The call then rejects with an `AbortError` (whose
   * `cause` is the signal's reason).
   */
  signal?: AbortSignal;
}

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
  /** Called when an unrecoverable upload error occurs, with the same `SlubyError` the handle rejects with. */
  onError?: (error: Error) => void;
  /**
   * Resume an unfinished upload of the same file with the same metadata by
   * the same key, from a previous page load (browser only; tus keeps the
   * upload URL in localStorage). An upload that already finished is never
   * resumed: the file is uploaded again as a new asset. Default `true`.
   */
  resume?: boolean;
  /** Aborts the upload like `handle.abort()` when it fires. */
  signal?: AbortSignal;
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
  /**
   * Cancel an unfinished upload: stop sending, terminate it on the server
   * (which discards the asset it created) and reject the handle with an
   * `AbortError`. Once the upload has finished this does nothing, so cleanup
   * code that always calls it never deletes a finished upload's asset.
   */
  abort: () => Promise<void>;
  /** Whether the upload is currently paused. */
  readonly isPaused: boolean;
};

/** Field the asset list can be ordered by. */
export type AssetSortField = 'created_at' | 'title' | 'duration' | 'size';

/** Options for listing video assets. */
export interface ListAssetsOptions extends RequestOptions {
  page?: number;
  limit?: number;
  /**
   * Keyset paging: the `nextCursor` of the previous page. Only works with the
   * default order (`created_at`, `desc`); use `page` for other orders.
   */
  cursor?: string;
  status?: VideoAssetStatus;
  accessTier?: AccessTier;
  /** Case-insensitive match on title or description, or an exact asset id. */
  search?: string;
  /** Default `created_at`. */
  sort?: AssetSortField;
  /** Default `desc`. */
  order?: 'asc' | 'desc';
}

/** Paginated response wrapper. */
export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  /** Pass as `cursor` to get the next page; null on the last page. */
  nextCursor: string | null;
  /** Whether there is a page after this one. */
  hasMore: boolean;
}

/**
 * Publishable viewer identity for direct-from-Sia playback (browser only).
 *
 * The web SDK has no anonymous mode, so the browser needs its own registered
 * Sia app key to construct an Sdk and download objects. This is a low-privilege
 * "viewer" identity, separate from the uploader's key: it can resolve shared
 * objects but never touches the uploader's content or key. Treat it like a
 * publishable key (e.g. a Mux public key), not a secret. Provision it once with
 * the viewer-provisioning script.
 */
export interface SiaViewerConfig {
  /** Indexer base URL the viewer connects to (e.g. "https://sia.storage"). */
  indexerUrl: string;
  /** 32-byte app id, hex. */
  appId: string;
  /** 32-byte viewer app key, hex. Publishable, low-privilege. */
  appKey: string;
  /** App display name shown to the indexer. Defaults to "Sluby Player". */
  name?: string;
  /** App description shown to the indexer. */
  description?: string;
  /** App service URL shown to the indexer. */
  serviceUrl?: string;
}

/**
 * Per-playback capability map: a short-lived sia:// share URL per object of an
 * asset, plus which object is the HLS master. Fetched from the backend's
 * public `GET /v1/share/:id` (see `SiaShareSource`) or the authenticated
 * `GET /api/v1/playback/:id/share`.
 */
export interface SiaShareMap {
  masterObjectId: string;
  /** object id (hex) -> sia:// share URL */
  shares: Record<string, string>;
  expiresAt: string;
}

/** Where a `SiaSession` gets an asset's share map from. */
export interface SiaShareSource {
  /**
   * The gateway playback URL being played: `/v1/stream/{id}/master.m3u8` (for
   * example from `playback.streamUrl`) or `/v1/objects/{id}`, signed or not,
   * absolute or relative to `deliveryBaseUrl`. When set, the share map comes
   * from the public `GET /v1/share/:id` on the same delivery base, with that
   * URL's `expires` and `sig` and no credentials, so a page without an API key
   * can play direct from Sia. When unset, the authenticated
   * `GET /api/v1/playback/:id/share` is used.
   */
  src?: string;
}

/** SDK client configuration. */
export interface SlubyConfig {
  /**
   * API key (Bearer token). Omit it in a browser app served from the same
   * origin as the API (such as the Studio): requests then carry the signed-in
   * session cookie instead of an Authorization header.
   */
  apiKey?: string;
  /** Base URL of the Sluby REST API (e.g. "https://api.sluby.app"). */
  baseUrl: string;
  /**
   * Cookie policy for requests, passed to `fetch` and applied to TUS uploads.
   * Leave unset for API-key auth or a same-origin session. Set `'include'`
   * only when a cookie session must cross origins (the API must then allow
   * credentialed CORS for your origin).
   */
  credentials?: RequestCredentials;
  /**
   * Base URL the browser fetches HLS bytes from directly: the delivery /
   * object gateway, optionally an nginx cache in front of it. Playback URLs
   * are resolved against this so the player retrieves manifests and segments
   * straight from Sia-backed delivery instead of through the REST API.
   *
   * Defaults to `baseUrl` when omitted.
   */
  deliveryBaseUrl?: string;
  /**
   * Viewer identity for direct-from-Sia playback. When set, `client.sia` is
   * available and the player can stream bytes straight from Sia (backend out
   * of the byte path). It needs no API key: given the playback URL, the share
   * map comes from the public share endpoint. Omit for REST-only or
   * gateway-delivery consumers; the WASM SDK is then never loaded.
   */
  sia?: SiaViewerConfig;
  /**
   * Abort any API request that has not finished (headers and body) within
   * this many milliseconds; it then rejects with a `TimeoutError`. Unset by
   * default: requests wait as long as the platform's fetch does. Uploads are
   * not covered, since tus retries on its own.
   */
  timeoutMs?: number;
}

/** Event names the backend sends. */
export type WebhookEventName =
  | 'upload.started'
  | 'upload.completed'
  | 'upload.failed'
  | 'processing.started'
  | 'asset.ready'
  | 'asset.errored';

/**
 * Webhook event payload delivered to registered endpoints. `data` is the
 * payload exactly as sent, with the backend's snake_case keys (such as
 * `video_asset_id`); it is not converted like the REST responses are.
 */
export interface WebhookEvent {
  /**
   * The event's id, the same on every retry of it: drop an id already
   * handled. Absent from events sent by backends before it was added.
   */
  id?: string;
  /** One of `WebhookEventName`; typed as a string so a newer backend's events still parse. */
  event: WebhookEventName | (string & {});
  timestamp: string;
  data: Record<string, unknown>;
}
