// ---------------------------------------------------------------------------
// @sluby/sdk - SiaSession (direct-from-Sia playback, browser only)
// ---------------------------------------------------------------------------

import { errorFromResponse } from './errors.js';
import type { FetchFn } from './uploads.js';
import type { SiaShareMap, SiaShareSource, SiaViewerConfig } from './types.js';

// Type-only: erased at build time, so importing these does NOT eagerly load
// the 1.7 MB WASM module. The runtime module is pulled in lazily on connect.
import type { Sdk, PinnedObject } from '@siafoundation/sia-storage';

/** Byte-range download options (browser numeric form). */
export interface SiaDownloadOptions {
  offset?: number;
  length?: number;
}

/** How a `SiaSession` reaches the public share endpoint. `SlubyClient` passes both. */
export interface SiaSessionTransport {
  /** GET an absolute URL with no credentials, throwing a `SlubyError` on failure. */
  fetchPublic?: (url: string) => Promise<Response>;
  /** Make a relative `src` absolute against the delivery base. */
  resolveDeliveryUrl?: (pathOrUrl: string) => string;
}

// a gateway playback url: the master by asset or playback id, or any object
const GATEWAY_PATH_RE = /\/v1\/(?:stream|objects)\//;

/**
 * The public share map URL for a gateway playback URL: `/v1/share/{id}` on the
 * same delivery base, carrying the playback URL's `expires` and `sig` (the
 * share endpoint checks the same signature over the master manifest). Throws
 * when `src` is not a `/v1/stream/...` or `/v1/objects/...` URL, since then
 * there is no delivery base to ask.
 */
export function publicShareMapUrl(assetId: string, src: string): string {
  const url = new URL(src);
  const match = GATEWAY_PATH_RE.exec(url.pathname);
  if (!match) {
    throw new Error(
      `SiaSession: ${src} is not a Sluby gateway playback URL ` +
        '(/v1/stream/{id}/master.m3u8 or /v1/objects/{id}), so there is no share map for it.',
    );
  }
  const prefix = url.pathname.slice(0, match.index);
  const share = new URL(`${prefix}/v1/share/${encodeURIComponent(assetId)}`, url.origin);
  for (const name of ['expires', 'sig']) {
    const value = url.searchParams.get(name);
    if (value !== null) share.searchParams.set(name, value);
  }
  return share.toString();
}

async function defaultFetchPublic(url: string): Promise<Response> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    credentials: 'omit',
  });
  if (response.ok) return response;
  throw await errorFromResponse(response);
}

/**
 * Owns the browser's viewer Sia session for direct-from-Sia playback: it
 * lazily loads the WASM SDK, connects with the publishable viewer app key,
 * fetches the per-playback share map from the backend, resolves shared objects,
 * and streams byte ranges straight from Sia. The player's custom hls.js loader
 * drives it; the backend is not in the byte path.
 *
 * Every method that needs a share map takes an optional `source`. With
 * `source.src` (the gateway playback URL being played, signed or not) the map
 * comes from the public `GET /v1/share/:id` next to that URL with no
 * credentials, so a page with no API key can play direct from Sia. Without it
 * the map comes from `GET /api/v1/playback/:id/share`, which needs the
 * client's key or session.
 *
 * Browser only. The WASM module is imported on first `connect()`, so REST-only
 * consumers that never touch `client.sia` pay no WASM cost.
 */
export class SiaSession {
  private readonly _fetch: FetchFn;
  private readonly _config: SiaViewerConfig;
  private readonly _fetchPublic: (url: string) => Promise<Response>;
  private readonly _resolveDeliveryUrl: (pathOrUrl: string) => string;

  private _sdk: Sdk | null = null;
  private _sdkPromise: Promise<Sdk> | null = null;
  // Share map per (asset, source), cached with its expiry so a long watch can
  // refresh it. Share URLs are short-lived, and a rendition first resolved
  // after the original map expired would otherwise fail.
  private readonly _shareMaps = new Map<string, { map: SiaShareMap; expiresAtMs: number }>();
  // Resolved shared objects, cached per (asset, source, object) so a repeat or
  // an ABR rendition switch does not re-resolve the same object.
  private readonly _objects = new Map<string, Promise<PinnedObject>>();

  // Refresh a share map this long before it actually expires, so a URL is not
  // used right at the edge of its validity.
  private static readonly REFRESH_MARGIN_MS = 60_000;

  constructor(fetchFn: FetchFn, config: SiaViewerConfig, transport: SiaSessionTransport = {}) {
    this._fetch = fetchFn;
    this._config = config;
    this._fetchPublic = transport.fetchPublic ?? defaultFetchPublic;
    this._resolveDeliveryUrl = transport.resolveDeliveryUrl ?? ((url) => url);
  }

  /**
   * Fetch the per-playback share map for an asset from the backend. This is a
   * REST call and does NOT require the WASM module, so the player can fetch it
   * before (or in parallel with) connecting. With `source.src` it is the
   * public share endpoint and carries no credentials; without it, the
   * authenticated API route.
   */
  async getShareMap(assetId: string, source?: SiaShareSource): Promise<SiaShareMap> {
    const res = source?.src
      ? await this._fetchPublic(this.shareMapUrl(assetId, source.src))
      : await this._fetch(`/api/v1/playback/${encodeURIComponent(assetId)}/share`);
    const body = (await res.json()) as {
      master_object_id: string;
      shares: Record<string, string>;
      expires_at: string;
    };
    return {
      masterObjectId: body.master_object_id,
      shares: body.shares ?? {},
      expiresAt: body.expires_at,
    };
  }

  /**
   * Lazily load the WASM SDK and connect with the viewer app key. Idempotent
   * and memoized; a failed attempt is not cached so a later call can retry.
   */
  async connect(): Promise<Sdk> {
    if (!this._sdkPromise) {
      this._sdkPromise = (async () => {
        const sia = await import('@siafoundation/sia-storage');
        await sia.initSia();
        const appId = this._config.appId.replace(/^0x/, '');
        if (!/^[0-9a-fA-F]{64}$/.test(appId)) {
          throw new Error('SiaSession: app id must be a 32-byte (64 hex char) string.');
        }
        const appMeta = {
          appId,
          name: this._config.name ?? 'Sluby Player',
          description: this._config.description ?? 'Sluby direct-from-Sia video player',
          serviceUrl: this._config.serviceUrl ?? this._config.indexerUrl,
          logoUrl: undefined,
          callbackUrl: undefined,
        };
        const builder = new sia.Builder(this._config.indexerUrl, appMeta);
        const appKey = new sia.AppKey(hexToBytes(this._config.appKey));
        const sdk = await builder.connected(appKey);
        if (!sdk) {
          throw new Error(
            'Sia viewer app key is not registered with the configured indexer. ' +
              'Provision a viewer identity (see the viewer-provisioning script) and set ' +
              'a valid { indexerUrl, appId, appKey } in SlubyConfig.sia.',
          );
        }
        this._sdk = sdk;
        return sdk;
      })().catch((err) => {
        this._sdkPromise = null;
        throw err;
      });
    }
    return this._sdkPromise;
  }

  /**
   * Warm the session for an asset: connect the WASM SDK and fetch its share
   * map. The player calls this once up front, so the sia-mode decision reflects
   * a working session and the share endpoint is confirmed before playback.
   */
  async prepare(assetId: string, source?: SiaShareSource): Promise<void> {
    await this.connect();
    await this.loadShareMap(assetId, source);
  }

  /**
   * The public share map URL used for `source.src`, made absolute against the
   * delivery base first when `src` is a path.
   */
  shareMapUrl(assetId: string, src: string): string {
    return publicShareMapUrl(assetId, this._resolveDeliveryUrl(src));
  }

  /**
   * The asset's HLS master object id, from its (cached) share map. The player's
   * loader uses it when hls.js asks for a `/v1/stream/{id}/master.m3u8` URL,
   * which names the asset rather than an object.
   */
  async masterObjectId(assetId: string, source?: SiaShareSource): Promise<string> {
    return (await this.loadShareMap(assetId, source)).masterObjectId;
  }

  // cache key for a (asset, source) pair; the public url already names the
  // asset and the signature, so two signed urls never share a map
  private sourceKey(assetId: string, source?: SiaShareSource): string {
    return source?.src ? `public ${this.shareMapUrl(assetId, source.src)}` : `api ${assetId}`;
  }

  /**
   * Get the asset's share map, cached; refetch when it is missing, near
   * expiry, or `force`d. Share URLs are short-lived, so a long watch refreshes
   * the map instead of reusing an expired one.
   */
  private async loadShareMap(
    assetId: string,
    source?: SiaShareSource,
    force = false,
  ): Promise<SiaShareMap> {
    const key = this.sourceKey(assetId, source);
    const cached = this._shareMaps.get(key);
    const now = Date.now();
    if (!force && cached && now < cached.expiresAtMs - SiaSession.REFRESH_MARGIN_MS) {
      return cached.map;
    }
    const map = await this.getShareMap(assetId, source);
    const parsed = Date.parse(map.expiresAt);
    this._shareMaps.set(key, { map, expiresAtMs: Number.isFinite(parsed) ? parsed : now });
    return map;
  }

  /**
   * Resolve an asset's object id to a downloadable handle, connecting and
   * (re)fetching the share map as needed. Cached per (asset, source, object).
   * If the object is absent from the cached map, or its share URL has just
   * expired, the map is refreshed once and the resolve retried, so a rendition
   * first touched after the original map expired still plays.
   */
  resolveObjectId(
    assetId: string,
    objectId: string,
    source?: SiaShareSource,
  ): Promise<PinnedObject> {
    // object ids are hex, so the part after the last space is always the object
    const key = `${this.sourceKey(assetId, source)} ${objectId}`;
    let pending = this._objects.get(key);
    if (!pending) {
      pending = (async () => {
        const sdk = await this.connect();
        let map = await this.loadShareMap(assetId, source);
        let shareUrl = map.shares[objectId];
        if (!shareUrl) {
          map = await this.loadShareMap(assetId, source, true);
          shareUrl = map.shares[objectId];
        }
        if (!shareUrl) {
          throw new Error(`SiaSession: no share URL for object ${objectId}`);
        }
        try {
          return await sdk.objectFromShareUrl(shareUrl);
        } catch (err) {
          // The URL may have expired between mint and use; refresh once and retry.
          const refreshed = await this.loadShareMap(assetId, source, true);
          const fresh = refreshed.shares[objectId];
          if (!fresh || fresh === shareUrl) throw err;
          return await sdk.objectFromShareUrl(fresh);
        }
      })().catch((err) => {
        this._objects.delete(key);
        throw err;
      });
      this._objects.set(key, pending);
    }
    return pending;
  }

  /**
   * Stream a byte range of a resolved object directly from Sia. `offset` /
   * `length` are plain numbers (browser build). Call `resolveObjectId` (or
   * `connect`) first so the SDK is connected.
   */
  download(object: PinnedObject, options?: SiaDownloadOptions): ReadableStream {
    if (!this._sdk) {
      throw new Error('SiaSession.download called before connect(); resolve an object first.');
    }
    return this._sdk.download(object, { offset: options?.offset, length: options?.length });
  }
}

/** Decode a 32-byte app key from hex (optionally `0x`-prefixed). */
function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length !== 64 || /[^0-9a-fA-F]/.test(clean)) {
    throw new Error('SiaSession: app key must be a 32-byte (64 hex char) string.');
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
