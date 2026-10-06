// ---------------------------------------------------------------------------
// @sluby/sdk - SlubyClient
// ---------------------------------------------------------------------------

import { AssetManager } from './assets.js';
import { AuthenticationError, NotFoundError, RateLimitError, SlubyError } from './errors.js';
import { PlaybackManager } from './playback.js';
import { SiaSession } from './sia-session.js';
import type { SlubyConfig } from './types.js';
import { UploadManager } from './uploads.js';
import { WebhookManager } from './webhooks.js';

/**
 * Primary entry point for the Sluby TypeScript SDK.
 *
 * @example
 * ```ts
 * import { SlubyClient } from '@sluby/sdk';
 *
 * const client = new SlubyClient({
 *   apiKey: 'sluby_...',
 *   baseUrl: 'https://api.sluby.app',
 * });
 *
 * // Upload a video via resumable TUS (creates the asset as it starts)
 * const upload = client.uploads.upload(file, {
 *   title: 'My Video',
 *   description: 'Demo upload',
 *   accessTier: 'public',
 *   onProgress: (pct) => console.log(`${pct}%`),
 * });
 * const videoAssetId = await upload.assetId;
 * await upload;
 *
 * // Wait until processing finishes
 * const asset = await client.assets.waitForReady(videoAssetId);
 *
 * // Retrieve the playback URL
 * const { playbackUrl } = await client.playback.getUrl(videoAssetId);
 * ```
 */
export class SlubyClient {
  /** Video upload management (resumable TUS upload, status, cancel). */
  readonly uploads: UploadManager;

  /** Video asset CRUD and lifecycle polling. */
  readonly assets: AssetManager;

  /** Playback URL retrieval (public and signed). */
  readonly playback: PlaybackManager;

  /** Webhook signature verification and event parsing utilities. */
  readonly webhooks: WebhookManager;

  /**
   * Direct-from-Sia viewer session (browser only). Present only when
   * `config.sia` is set; the player uses it to stream bytes straight from Sia
   * with the backend out of the byte path. Undefined for REST-only consumers.
   */
  readonly sia?: SiaSession;

  private readonly _config: SlubyConfig;

  constructor(config: SlubyConfig) {
    // an empty string usually means an unset env var, so fail loudly instead
    // of quietly falling back to cookie auth
    if (config.apiKey !== undefined && !config.apiKey) {
      throw new Error(
        'SlubyClient apiKey must be non-empty when provided; omit it to use a cookie session.',
      );
    }
    if (!config.baseUrl) {
      throw new Error('SlubyClient requires a non-empty baseUrl.');
    }

    // Normalise the base URLs: remove trailing slashes to simplify path
    // concatenation. The delivery base defaults to the API base.
    const baseUrl = config.baseUrl.replace(/\/+$/, '');
    this._config = {
      ...config,
      baseUrl,
      deliveryBaseUrl: (config.deliveryBaseUrl ?? baseUrl).replace(/\/+$/, ''),
    };

    // Bind the internal fetch helper and pass it to each sub-manager so
    // they share authentication and error-handling logic.
    const boundFetch = this._fetch.bind(this);

    this.uploads = new UploadManager(boundFetch, {
      apiKey: this._config.apiKey,
      baseUrl: this._config.baseUrl,
      credentials: this._config.credentials,
    });
    this.assets = new AssetManager(boundFetch);
    this.playback = new PlaybackManager(boundFetch, this.resolveDeliveryUrl.bind(this));
    this.webhooks = new WebhookManager();
    this.sia = this._config.sia ? new SiaSession(boundFetch, this._config.sia) : undefined;
  }

  // -----------------------------------------------------------------------
  // Delivery URL resolution
  // -----------------------------------------------------------------------

  /**
   * Resolve a server-relative delivery path (e.g. `/v1/objects/abc?type=manifest`)
   * into an absolute URL the browser fetches directly from Sia-backed delivery.
   *
   * Absolute URLs are returned unchanged, so it is safe to call on values that
   * may already be fully qualified.
   */
  resolveDeliveryUrl(pathOrUrl: string): string {
    if (/^https?:\/\//i.test(pathOrUrl)) {
      return pathOrUrl;
    }
    const base = this._config.deliveryBaseUrl ?? this._config.baseUrl;
    return `${base}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
  }

  // -----------------------------------------------------------------------
  // Internal HTTP helper
  // -----------------------------------------------------------------------

  /**
   * Perform an HTTP request against the Sluby API.
   *
   * - Automatically prepends the base URL.
   * - Injects the `Authorization: Bearer <apiKey>` header when an API key is
   *   configured; otherwise the request rides on the session cookie.
   * - Inspects the response status and throws typed errors for common
   *   failure modes (401/403, 404, 429, 5xx).
   */
  private async _fetch(path: string, init?: RequestInit): Promise<Response> {
    const url = `${this._config.baseUrl}${path}`;

    const headers = new Headers(init?.headers);
    if (this._config.apiKey) {
      headers.set('Authorization', `Bearer ${this._config.apiKey}`);
    }

    // Set a default Accept header when not already provided.
    if (!headers.has('Accept')) {
      headers.set('Accept', 'application/json');
    }

    const response = await fetch(url, {
      ...init,
      headers,
      ...(this._config.credentials ? { credentials: this._config.credentials } : {}),
    });

    if (response.ok) {
      return response;
    }

    // ---- Error handling ----

    let responseBody: string | undefined;
    try {
      responseBody = await response.text();
    } catch {
      // Reading the body may fail; that is acceptable.
    }

    const message = extractErrorMessage(responseBody, response.statusText);

    switch (response.status) {
      case 401:
      case 403:
        throw new AuthenticationError(message, response.status, responseBody);
      case 404:
        throw new NotFoundError(message, responseBody);
      case 429:
        throw new RateLimitError(
          message,
          parseRetryAfter(response.headers.get('Retry-After')),
          responseBody,
        );
      default:
        throw new SlubyError(message, response.status, responseBody);
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Seconds to wait from a Retry-After header. RFC 9110 allows either a number
 * of seconds or an HTTP date, and a plain Number() turns the date form into NaN.
 */
function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

/**
 * Attempt to extract a human-readable error message from the response body
 * (expecting `{ "error": "..." }` or `{ "message": "..." }`), falling back
 * to the status text.
 */
function extractErrorMessage(responseBody: string | undefined, statusText: string): string {
  if (responseBody) {
    try {
      const json = JSON.parse(responseBody);
      if (typeof json.error === 'string') return json.error;
      if (typeof json.message === 'string') return json.message;
    } catch {
      // Not JSON -- use the raw text if short enough.
      if (responseBody.length < 200) return responseBody;
    }
  }
  return statusText || 'Unknown API error';
}
