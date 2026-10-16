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
