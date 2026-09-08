// ---------------------------------------------------------------------------
// @sluby/sdk - SiaSession (direct-from-Sia playback, browser only)
// ---------------------------------------------------------------------------

import type { FetchFn } from './uploads.js';
import type { SiaShareMap, SiaViewerConfig } from './types.js';

// Type-only: erased at build time, so importing these does NOT eagerly load
// the 1.7 MB WASM module. The runtime module is pulled in lazily on connect.
import type { Sdk, PinnedObject } from 'sia-storage';

/** Byte-range download options (browser numeric form). */
export interface SiaDownloadOptions {
  offset?: number;
  length?: number;
}

/**
 * Owns the browser's viewer Sia session for direct-from-Sia playback: it
 * lazily loads the WASM SDK, connects with the publishable viewer app key,
 * fetches the per-playback share map from the backend, resolves shared objects,
 * and streams byte ranges straight from Sia. The player's custom hls.js loader
 * drives it; the backend is not in the byte path.
 *
 * Browser only. The WASM module is imported on first `connect()`, so REST-only
 * consumers that never touch `client.sia` pay no WASM cost.
 */
export class SiaSession {
  private readonly _fetch: FetchFn;
  private readonly _config: SiaViewerConfig;

  private _sdk: Sdk | null = null;
  private _sdkPromise: Promise<Sdk> | null = null;
  // Resolved shared objects, cached per share URL (the decryption capability),
  // so an ABR rendition switch mid-playback does not re-resolve the same object.
  private readonly _objects = new Map<string, Promise<PinnedObject>>();

  constructor(fetchFn: FetchFn, config: SiaViewerConfig) {
    this._fetch = fetchFn;
    this._config = config;
  }

  /**
   * Fetch the per-playback share map for an asset from the backend. This is a
   * REST call and does NOT require the WASM module, so the player can fetch it
   * before (or in parallel with) connecting.
   */
  async getShareMap(assetId: string): Promise<SiaShareMap> {
    const res = await this._fetch(`/api/v1/playback/${encodeURIComponent(assetId)}/share`);
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
        const sia = await import('sia-storage');
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
   * Resolve a sia:// share URL to a downloadable object handle, connecting
   * first if needed. Cached per share URL.
   */
  resolveObject(shareUrl: string): Promise<PinnedObject> {
    let pending = this._objects.get(shareUrl);
    if (!pending) {
      pending = (async () => {
        const sdk = await this.connect();
        return sdk.sharedObject(shareUrl);
      })().catch((err) => {
        this._objects.delete(shareUrl);
        throw err;
      });
      this._objects.set(shareUrl, pending);
    }
    return pending;
  }

  /**
   * Stream a byte range of a resolved object directly from Sia. `offset` /
   * `length` are plain numbers (browser build). Call `resolveObject` (or
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
