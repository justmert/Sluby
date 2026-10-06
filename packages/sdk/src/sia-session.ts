// ---------------------------------------------------------------------------
// @sluby/sdk - SiaSession (direct-from-Sia playback, browser only)
// ---------------------------------------------------------------------------

import { NotFoundError, SlubyError, errorFromResponse, readJson } from './errors.js';
import type { FetchFn } from './uploads.js';
import type { SiaShareMap, SiaShareSource, SiaViewerConfig } from './types.js';

// Type-only and kept out of every public signature: erased at build time, so
// the WASM module is not loaded eagerly, and the published declarations do
// not pull in sia-storage's own (which need `lib: esnext`).
import type { Sdk, PinnedObject } from '@siafoundation/sia-storage';

declare const siaObjectBrand: unique symbol;

/**
 * A shared Sia object resolved by `resolveObjectId`, ready for `download`.
 * Opaque: only pass it back to the session that returned it. The session owns
 * it and frees it when it drops it from its cache or on `dispose()`.
 */
export interface SiaObject {
  readonly [siaObjectBrand]: true;
}

/** Byte-range download options (browser numeric form). */
export interface SiaDownloadOptions {
  offset?: number;
  length?: number;
}

/** How a `SiaSession` reaches the public share endpoint. `SlubyClient` passes both. */
export interface SiaSessionTransport {
  /** GET an absolute URL with no credentials, throwing a `SlubyError` on failure. */
  fetchPublic?: (url: string) => Promise<Response>;
  /**
   * Make a relative `src` absolute against the delivery base. Without it a
   * `src` must already be an absolute URL.
   */
  resolveDeliveryUrl?: (pathOrUrl: string) => string;
}

// a gateway playback url: the master by asset or playback id, or any object
const GATEWAY_PATH_RE = /\/v1\/(?:stream|objects)\//;
const STREAM_PATH_RE = /\/v1\/stream\/([^/]+)\/master\.m3u8$/;

/**
 * The public share map URL for a gateway playback URL: `/v1/share/{id}` on the
 * same delivery base, carrying the playback URL's `expires` and `sig` (the
 * share endpoint checks the same signature over the master manifest).
 *
 * For a `/v1/stream/{id}/master.m3u8` URL the share id is the `{id}` in it,
 * the asset or playback id the URL was issued for, whatever `assetId` says;
 * for a `/v1/objects/{id}` URL, which names an object, it is `assetId`.
 * Throws when `src` is not a `/v1/stream/...` or `/v1/objects/...` URL, since
 * then there is no delivery base to ask.
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
  const stream = STREAM_PATH_RE.exec(url.pathname);
  const shareId = stream ? decodeURIComponent(stream[1]) : assetId;
  const prefix = url.pathname.slice(0, match.index);
  const share = new URL(`${prefix}/v1/share/${encodeURIComponent(shareId)}`, url.origin);
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

function requireAbsolute(src: string): string {
  if (/^https?:\/\//i.test(src)) return src;
  throw new Error(
    `SiaSession: ${src} is relative, and this session has no delivery base to resolve it ` +
      'against. Use the session of a SlubyClient, pass transport.resolveDeliveryUrl, or ' +
      'pass an absolute src.',
  );
}

// Refresh a share map this long before it actually expires, so a URL is not
// used right at the edge of its validity.
const REFRESH_MARGIN_MS = 60_000;

interface CachedShareMap {
  map: SiaShareMap;
  expiresAtMs: number;
  fetchedAtMs: number;
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
 * A map fetched for a signed `src` never outlives that signature, so playback
 * past it needs a newly signed `src` (the player's `refreshSrc`).
 *
 * Browser only. The WASM module is imported on first `connect()`, so REST-only
 * consumers that never touch `client.sia` pay no WASM cost. Resolved objects
 * are cached (at most `MAX_CACHED_OBJECTS`, least recently used dropped
 * first); call `dispose()` when the session is no longer needed.
 */
export class SiaSession {
  /** How many resolved objects the session keeps before dropping the least recently used. */
  static readonly MAX_CACHED_OBJECTS = 64;

  private readonly _fetch: FetchFn;
  private readonly _config: SiaViewerConfig;
  private readonly _fetchPublic: (url: string) => Promise<Response>;
  private readonly _resolveDeliveryUrl: (pathOrUrl: string) => string;

  private _sdk: Sdk | null = null;
  private _sdkPromise: Promise<Sdk> | null = null;
  // bumped by dispose(), so a connect that was under way when it ran is dropped
  private _generation = 0;
  // Share map per (asset, source), cached with its expiry so a long watch can
  // refresh it. Share URLs are short-lived, and a rendition first resolved
  // after the original map expired would otherwise fail.
  private readonly _shareMaps = new Map<string, CachedShareMap>();
  // one request per (asset, source) at a time, however many resolves wait on it
  private readonly _shareMapFetches = new Map<string, Promise<SiaShareMap>>();
  // Resolved objects per (asset, object), in least recently used order, so a
  // repeat or an ABR rendition switch does not re-resolve the same object.
  private readonly _objects = new Map<string, Promise<PinnedObject>>();

  constructor(fetchFn: FetchFn, config: SiaViewerConfig, transport: SiaSessionTransport = {}) {
    this._fetch = fetchFn;
    this._config = config;
    this._fetchPublic = transport.fetchPublic ?? defaultFetchPublic;
    this._resolveDeliveryUrl = transport.resolveDeliveryUrl ?? requireAbsolute;
  }

  /**
   * Fetch the per-playback share map for an asset from the backend. This is a
   * REST call and does NOT require the WASM module, so the player can fetch it
   * before (or in parallel with) connecting. With `source.src` it is the
   * public share endpoint and carries no credentials; without it, the
   * authenticated API route. Rejects with a `SlubyError` when the answer has
   * no usable `expires_at`.
   */
  async getShareMap(assetId: string, source?: SiaShareSource): Promise<SiaShareMap> {
    const res = source?.src
      ? await this._fetchPublic(this.shareMapUrl(assetId, source.src))
      : await this._fetch(`/api/v1/playback/${encodeURIComponent(assetId)}/share`);
    const body = await readJson<{
      master_object_id: string;
      shares?: Record<string, string>;
      expires_at: string;
    }>(res);
    if (!Number.isFinite(Date.parse(body.expires_at))) {
      throw new SlubyError(
        `SiaSession: the share map for ${assetId} has no valid expires_at (${String(body.expires_at)}).`,
        res.status,
      );
    }
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
  async connect(): Promise<void> {
    await this._connect();
  }

  private _connect(): Promise<Sdk> {
    if (!this._sdkPromise) {
      const generation = this._generation;
      const attempt: Promise<Sdk> = (async () => {
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
        // dispose() during the connect drops this attempt
        if (this._generation !== generation) {
          sdk.free();
          throw new Error('SiaSession was disposed while connecting.');
        }
        this._sdk = sdk;
        return sdk;
      })().catch((err) => {
        if (this._sdkPromise === attempt) this._sdkPromise = null;
        throw err;
      });
      this._sdkPromise = attempt;
    }
    return this._sdkPromise;
  }

  /**
   * Warm the session for an asset: connect the WASM SDK and fetch its share
   * map. The player calls this once up front, so the sia-mode decision reflects
   * a working session and the share endpoint is confirmed before playback.
   */
  async prepare(assetId: string, source?: SiaShareSource): Promise<void> {
    await this._connect();
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

  /**
   * Resolve an asset's object id to a downloadable handle, connecting and
   * (re)fetching the share map as needed. Cached per (asset, object). If the
   * object is absent from the cached map, or its share URL fails while the map
   * is near or past its expiry, the map is refreshed once and the resolve
   * retried, so a rendition first touched after the original map expired
   * still plays. Rejects with a `NotFoundError` when the map has no share URL
   * for the object.
   */
  async resolveObjectId(
    assetId: string,
    objectId: string,
    source?: SiaShareSource,
  ): Promise<SiaObject> {
    const key = `${assetId} ${objectId}`;
    let pending = this._objects.get(key);
    if (pending) {
      // most recently used goes last
      this._objects.delete(key);
      this._objects.set(key, pending);
    } else {
      // a failed resolve is not cached, so the next call tries again
      const created: Promise<PinnedObject> = this._resolve(assetId, objectId, source).catch(
        (err: unknown) => {
          if (this._objects.get(key) === created) this._objects.delete(key);
          throw err;
        },
      );
      pending = created;
      this._objects.set(key, created);
      this._evict();
    }
    return (await pending) as unknown as SiaObject;
  }

  private async _resolve(
    assetId: string,
    objectId: string,
    source: SiaShareSource | undefined,
  ): Promise<PinnedObject> {
    const sdk = await this._connect();
    let map = await this.loadShareMap(assetId, source);
    let shareUrl = map.shares[objectId];
    if (!shareUrl) {
      map = await this.loadShareMap(assetId, source, true);
      shareUrl = map.shares[objectId];
    }
    if (!shareUrl) {
      throw new NotFoundError(`SiaSession: no share URL for object ${objectId}`);
    }
    try {
      return await sdk.objectFromShareUrl(shareUrl);
    } catch (err) {
      // a share url only goes bad by expiring; any other failure (a host or
      // indexer hiccup) is the caller's to retry, not a reason to re-mint
      const cached = this._shareMaps.get(this.sourceKey(assetId, source));
      if (cached && Date.now() < cached.expiresAtMs - REFRESH_MARGIN_MS) throw err;
      const refreshed = await this.loadShareMap(assetId, source, true);
      const fresh = refreshed.shares[objectId];
      if (!fresh || fresh === shareUrl) throw err;
      return await sdk.objectFromShareUrl(fresh);
    }
  }

  /**
   * Stream a byte range of a resolved object directly from Sia. `offset` /
   * `length` are plain numbers (browser build). Call `resolveObjectId` (or
   * `connect`) first so the SDK is connected.
   */
  download(object: SiaObject, options?: SiaDownloadOptions): ReadableStream {
    if (!this._sdk) {
      throw new Error('SiaSession.download called before connect(); resolve an object first.');
    }
    return this._sdk.download(object as unknown as PinnedObject, {
      offset: options?.offset,
      length: options?.length,
    });
  }

  /**
   * Free every resolved object and the WASM SDK and forget the share maps.
   * The session stays usable: the next call connects again. Streams already
   * returned by `download` keep running.
   */
  dispose(): void {
    for (const pending of this._objects.values()) freeWhenResolved(pending);
    this._objects.clear();
    this._shareMaps.clear();
    this._shareMapFetches.clear();
    const sdk = this._sdk;
    this._sdk = null;
    this._sdkPromise = null;
    this._generation += 1;
    sdk?.free();
  }

  private _evict(): void {
    while (this._objects.size > SiaSession.MAX_CACHED_OBJECTS) {
      const [oldest, pending] = this._objects.entries().next().value as [
        string,
        Promise<PinnedObject>,
      ];
      this._objects.delete(oldest);
      freeWhenResolved(pending);
    }
  }

  // cache key for a (asset, source) pair; the public url already names the
  // share id and the signature, so two signed urls never share a map
  private sourceKey(assetId: string, source?: SiaShareSource): string {
    return source?.src ? `public ${this.shareMapUrl(assetId, source.src)}` : `api ${assetId}`;
  }

  /**
   * Get the asset's share map, cached; refetch when it is missing, near
   * expiry, or `force`d, with one request in flight per (asset, source).
   *
   * A map fetched inside the refresh margin is used until it actually
   * expires: the backend caps a signed `src`'s map at the signature's expiry,
   * so fetching again could not get a later one and would only repeat the
   * request on every resolve.
   */
  private async loadShareMap(
    assetId: string,
    source?: SiaShareSource,
    force = false,
  ): Promise<SiaShareMap> {
    const key = this.sourceKey(assetId, source);
    const cached = this._shareMaps.get(key);
    if (!force && cached && isUsable(cached, Date.now())) return cached.map;

    const inflight = this._shareMapFetches.get(key);
    if (inflight) return inflight;
    const fetching = (async () => {
      const map = await this.getShareMap(assetId, source);
      this._shareMaps.set(key, {
        map,
        expiresAtMs: Date.parse(map.expiresAt),
        fetchedAtMs: Date.now(),
      });
      return map;
    })().finally(() => {
      if (this._shareMapFetches.get(key) === fetching) this._shareMapFetches.delete(key);
    });
    this._shareMapFetches.set(key, fetching);
    return fetching;
  }
}

function isUsable(entry: CachedShareMap, now: number): boolean {
  if (now >= entry.expiresAtMs) return false;
  const refreshAt = entry.expiresAtMs - REFRESH_MARGIN_MS;
  return now < refreshAt || entry.fetchedAtMs >= refreshAt;
}

function freeWhenResolved(pending: Promise<PinnedObject>): void {
  pending.then(
    (object) => object.free(),
    () => {
      // a failed resolve holds nothing to free
    },
  );
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
