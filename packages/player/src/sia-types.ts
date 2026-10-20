// the direct-from-sia types, kept apart from the react ones so the react-free
// `@sluby/player/hls` entry and its declarations never reference react

/**
 * Where the session gets an asset's share map. With `src` (the gateway
 * playback URL being played, signed or not) it is the public
 * `GET /v1/share/:id` next to that URL, with no credentials; without it, the
 * authenticated `GET /api/v1/playback/:id/share`.
 */
export interface SiaShareSource {
  src?: string;
}

/**
 * The `client.sia` viewer session the player drives for direct-from-Sia
 * playback. Structural (no hard dependency on `@sluby/sdk` or the WASM SDK):
 * resolved objects are opaque handles the loader passes straight back to
 * `download`. `source` is optional, so a session written against the older
 * two-argument shape still fits; it then always uses the authenticated route.
 *
 * A rejection that carries a numeric `statusCode` from 400 to 499 (as the
 * SDK's `SlubyError` does) is final for that load; any other failure is
 * reported to hls.js as retryable.
 */
export interface SiaPlaybackSession {
  prepare(assetId: string, source?: SiaShareSource): Promise<void>;
  resolveObjectId(assetId: string, objectId: string, source?: SiaShareSource): Promise<unknown>;
  download(object: unknown, options?: { offset?: number; length?: number }): ReadableStream;
  /**
   * The asset's HLS master object id. Needed to play a
   * `/v1/stream/{id}/master.m3u8` URL, which names the asset rather than an
   * object; `/v1/objects/{id}` URLs work without it.
   */
  masterObjectId?(assetId: string, source?: SiaShareSource): Promise<string>;
}

/**
 * When the hybrid loader may take a segment from Sia instead of the gateway.
 * Every field is optional where it is accepted; the defaults are noted.
 */
export interface HybridPolicy {
  /**
   * Seconds of video buffered ahead of the playhead before a segment may come
   * from Sia. Below it every segment comes from the gateway, so a start, a
   * seek or a nearly empty buffer never waits on Sia. Default 10.
   */
  minBufferSec: number;
  /**
   * Seconds kept in hand when a Sia read runs long: the read is cut off while
   * this much buffer is left, and the gateway fetches the segment in time.
   * Default 4.
   */
  safetyMarginSec: number;
  /** The longest a single Sia read may take, however full the buffer is. Default 20000. */
  maxSiaWaitMs: number;
  /** Sia reads in a row that may fail or run long before Sia is paused. Default 3. */
  maxFailures: number;
  /** How long Sia is paused after that, with every segment from the gateway. Default 60000. */
  pauseMs: number;
}

/** Where the segments of one load came from so far, under hybrid delivery. */
export interface HybridDeliveryStats {
  /** Media bytes read straight from Sia hosts. */
  siaBytes: number;
  /** Media bytes fetched through the gateway, including the fallbacks below. */
  gatewayBytes: number;
  siaSegments: number;
  gatewaySegments: number;
  /** Segments Sia started but the gateway delivered, after a Sia read failed or ran long. */
  fallbacks: number;
}
