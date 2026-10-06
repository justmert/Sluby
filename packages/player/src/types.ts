export interface QualityLevel {
  index: number;
  width: number;
  height: number;
  bitrate: number;
  name: string;
}

/** High-level playback state, surfaced via `onStateChange`. */
export type PlayerState = 'idle' | 'loading' | 'ready' | 'buffering' | 'error';

/**
 * Per-playback capability map: a short-lived sia:// share URL per object of an
 * asset, plus which object is the HLS master.
 */
export interface SiaShareMap {
  masterObjectId: string;
  /** object id (hex) -> sia:// share URL */
  shares: Record<string, string>;
  expiresAt: string;
}

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
 * Minimal structural interface a `SlubyClient` satisfies. The player accepts
 * it so it can resolve an absolute delivery URL from an asset id on its own,
 * without a hard dependency on `@sluby/sdk`.
 */
export interface PlaybackResolver {
  resolveDeliveryUrl(pathOrUrl: string): string;
  playback: {
    getUrl(assetId: string): Promise<{ playbackUrl: string; posterUrl: string | null }>;
    getSignedUrl(assetId: string, options?: { expiresIn?: number }): Promise<{ signedUrl: string }>;
  };
  /**
   * Present when a viewer identity is configured. When available (and hls.js is
   * used), the player streams bytes directly from Sia via a custom loader,
   * with the backend out of the byte path. Absent for gateway-only clients.
   */
  sia?: SiaPlaybackSession;
}

export interface SlubyPlayerProps {
  /**
   * Absolute HLS master manifest URL on the gateway, such as
   * `client.playback.streamUrl(id)` or a signed URL from your server. Provide
   * this, or `client` + `assetId` to have the player resolve the URL through
   * the API. With `src`, `assetId` and a `client` that has a Sia session, the
   * player streams direct from Sia using the public share map for `src`, so
   * no API key is needed.
   */
  src?: string;
  /**
   * A `SlubyClient` (or compatible resolver). With `assetId` and no `src` it
   * resolves the playback URL through the API; with `src` only its `sia`
   * session is used.
   */
  client?: PlaybackResolver;
  /** Asset id (or `pb_...` playback id) of the video: resolved via `client`, or paired with `src` for direct-from-Sia playback. */
  assetId?: string;
  /** Resolve a signed (private/gated) URL instead of the public one. */
  signed?: boolean;
  /** Lifetime in seconds for the signed URL when `signed` is set. */
  expiresIn?: number;

  poster?: string;
  autoPlay?: boolean;
  controls?: boolean;
  muted?: boolean;
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: React.CSSProperties;

  /** Render the built-in loading spinner / error overlay. Default: true. */
  overlay?: boolean;
  /** Max recoveries from fatal network errors before giving up. Default: 3. */
  maxNetworkRetries?: number;
  /** Max recoveries from fatal media errors before giving up. Default: 2. */
  maxMediaRetries?: number;

  onReady?: () => void;
  onPlay?: () => void;
  onPause?: () => void;
  onEnd?: () => void;
  onError?: (error: Error) => void;
  /** The rendition now playing, on load and on every switch. */
  onQualityChange?: (level: QualityLevel) => void;
  /** Every rendition in the manifest, once it is parsed (hls.js path only). */
  onQualitiesChange?: (levels: QualityLevel[]) => void;
  /**
   * How bytes reach the player for this load: `sia` streams straight from Sia
   * hosts through the viewer session, `gateway` goes through the HTTP gateway
   * (no viewer key, Safari's native path, or a failed Sia session).
   */
  onDeliveryChange?: (mode: 'sia' | 'gateway') => void;
  onStateChange?: (state: PlayerState) => void;
}

export interface UseVideoReturn {
  play: () => void;
  pause: () => void;
  seek: (time: number) => void;
  setQuality: (levelIndex: number) => void;
  qualities: QualityLevel[];
  currentQuality: QualityLevel | null;
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  isBuffering: boolean;
  volume: number;
  setVolume: (vol: number) => void;
}
