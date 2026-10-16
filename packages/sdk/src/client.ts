// ---------------------------------------------------------------------------
// @sluby/sdk - SlubyClient
// ---------------------------------------------------------------------------

import { AssetManager } from './assets.js';
import { AbortError, TimeoutError, errorFromResponse } from './errors.js';
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
    if (
      config.timeoutMs !== undefined &&
      !(Number.isFinite(config.timeoutMs) && config.timeoutMs > 0)
    ) {
      throw new Error('SlubyClient timeoutMs must be a positive number of milliseconds.');
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
    this.sia = this._config.sia
      ? new SiaSession(boundFetch, this._config.sia, {
          fetchPublic: this._fetchPublic.bind(this),
          resolveDeliveryUrl: this.resolveDeliveryUrl.bind(this),
        })
      : undefined;
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
   * - Inspects the response status and throws typed errors (see
   *   `errorFromStatus`).
   * - Reads the whole body before resolving, so `init.signal` and
   *   `SlubyConfig.timeoutMs` cover the body as well as the headers.
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

    return this._send(path, url, {
      ...init,
      headers,
      ...(this._config.credentials ? { credentials: this._config.credentials } : {}),
    });
  }

  /**
   * GET an absolute delivery URL with no credentials at all: no
   * Authorization header and no cookies. Used for the public share map, which
   * a page with no key must be able to fetch from any origin.
   */
  private async _fetchPublic(url: string): Promise<Response> {
    return this._send(url, url, {
      headers: { Accept: 'application/json' },
      credentials: 'omit',
    });
  }

  private async _send(label: string, url: string, init: RequestInit): Promise<Response> {
    const callerSignal = init.signal ?? undefined;
    if (callerSignal?.aborted) throw abortError(callerSignal);

    // one signal for fetch that fires on the caller's signal or the timeout,
    // whichever comes first, so the rejection can say which it was
    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onCallerAbort = () => controller.abort(callerSignal?.reason);
    callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
    const timeoutMs = this._config.timeoutMs;
    if (timeoutMs !== undefined) {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
    }

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!response.ok) throw await errorFromResponse(response);
      // buffer the body under the same signal and timeout; every API response
      // is a small JSON document
      const body = NULL_BODY_STATUSES.has(response.status) ? null : await response.text();
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (err) {
      if (timedOut) {
        throw new TimeoutError(`Request to ${label} timed out after ${timeoutMs} ms.`);
      }
      if (callerSignal?.aborted) throw abortError(callerSignal);
      // transport failures stay the platform's own error (a TypeError from
      // fetch), so callers can tell them from API errors
      throw err;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    }
  }
}

// statuses whose Response must be built with a null body
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

function abortError(signal: AbortSignal): AbortError {
  return new AbortError('The request was aborted.', { cause: signal.reason });
}
