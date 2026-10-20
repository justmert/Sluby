import type { CSSProperties } from 'react';
import type { HybridDeliveryStats, HybridPolicy, SiaPlaybackSession } from './sia-types.js';

export type {
  HybridDeliveryStats,
  HybridPolicy,
  SiaPlaybackSession,
  SiaShareSource,
} from './sia-types.js';

export interface QualityLevel {
  index: number;
  width: number;
  height: number;
  bitrate: number;
  name: string;
}

/** A caption or subtitle file for the `tracks` prop. */
export interface TextTrackSource {
  /** URL of a WebVTT file. */
  src: string;
  kind: 'subtitles' | 'captions';
  /** BCP 47 language tag, such as `en`. */
  srclang: string;
  /** The name players show in their track menu, such as `English`. */
  label: string;
  /** Show this track unless the viewer picks another. */
  default?: boolean;
}

/** High-level playback state, surfaced via `onStateChange`. */
export type PlayerState = 'idle' | 'loading' | 'ready' | 'buffering' | 'error';

/**
 * The part of a `SlubyClient` the player uses when it is given `src`: only the
 * viewer session. Any object with an optional `sia` fits, so a keyless page
 * can pass just `{ sia }`.
 */
export interface SiaPlaybackClient {
  /**
   * Present when a viewer identity is configured. When available (and hls.js is
   * used), the player streams bytes directly from Sia via a custom loader,
   * with the backend out of the byte path. Absent for gateway-only clients.
   */
  sia?: SiaPlaybackSession;
}

/**
 * Minimal structural interface a `SlubyClient` satisfies. The player accepts
 * it so it can resolve an absolute delivery URL from an asset id on its own,
 * without a hard dependency on `@sluby/sdk`.
 */
export interface PlaybackResolver extends SiaPlaybackClient {
  playback: {
    getUrl(assetId: string): Promise<{
      playbackUrl: string;
      posterUrl: string | null;
      accessTier?: 'public' | 'private';
    }>;
    getSignedUrl(
      assetId: string,
      options?: { expiresIn?: number },
    ): Promise<{ signedUrl: string; expiresAt?: string; posterUrl?: string | null }>;
  };
}

export interface SlubyPlayerProps {
  /**
   * Absolute HLS master manifest URL on the gateway, such as
   * `client.playback.streamUrl(id)` or a signed URL from your server. Provide
   * this, or `client` + `assetId` to have the player resolve the URL through
   * the API. With `src`, `assetId` and a `client` that has a Sia session, the
   * player streams direct from Sia using the public share map for `src`, so
   * no API key is needed. A new `src` for the same video (a re-signed URL)
   * keeps playing without a reload; later requests use its signatures.
   */
  src?: string;
  /**
   * A signed `src` stops working at its `expires`. Given this, the player
   * calls it shortly before then (and when a load fails after it) with the
   * current `src`, and keeps playing on the URL it returns, such as one
   * freshly signed by your server, without a reload. Without it, playback
   * of a signed `src` fails at the expiry.
   */
  refreshSrc?: (src: string) => string | Promise<string>;
  /**
   * A `SlubyClient` (or compatible resolver). With `assetId` and no `src` it
   * resolves the playback URL through the API; with `src` only its `sia`
   * session is used, so `{ sia }` alone is enough. Pass a stable object
   * (created once, not on every render): a different client resolves and
   * loads the video again.
   */
  client?: PlaybackResolver | SiaPlaybackClient;
  /** Asset id (or `pb_...` playback id) of the video: resolved via `client`, or paired with `src` for direct-from-Sia playback. */
  assetId?: string;
  /**
   * Resolve a signed (private/gated) URL instead of the public one. A private
   * asset is played signed even without it. Before a signed URL expires the
   * player fetches a new one and continues from the same position. Ignored
   * with `src`.
   */
  signed?: boolean;
  /** Lifetime in seconds of each signed URL the player fetches. Ignored with `src`. */
  expiresIn?: number;

  poster?: string;
  /**
   * The video's name for screen readers, set as the `<video>`'s `aria-label`.
   * Without it a screen reader announces only "video".
   */
  title?: string;
  /**
   * Caption and subtitle files (WebVTT) as `<track>` elements. Tracks on
   * another origin need `crossOrigin` and CORS headers on that origin.
   */
  tracks?: TextTrackSource[];
  /**
   * The `<video>`'s `crossorigin` attribute. Leave it out unless something
   * needs it: cross-origin `tracks` do, and the media origin must then send
   * CORS headers.
   */
  crossOrigin?: '' | 'anonymous' | 'use-credentials';
  autoPlay?: boolean;
  controls?: boolean;
  muted?: boolean;
  width?: number | string;
  height?: number | string;
  className?: string;
  style?: CSSProperties;

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
  /** A terminal error. `cause` holds the underlying error when there is one (an SDK `SlubyError`, an hls.js error). */
  onError?: (error: Error) => void;
  /** The rendition now playing, on load and on every switch. */
  onQualityChange?: (level: QualityLevel) => void;
  /** Every rendition in the manifest, once it is parsed (hls.js path only). */
  onQualitiesChange?: (levels: QualityLevel[]) => void;
  /**
   * How a video with a viewer session is delivered. `direct` (the default)
   * streams every playlist and segment from Sia. `hybrid` plays the start, and
   * whatever is needed urgently, through the gateway and takes the rest from
   * Sia once the buffer is comfortable, so a video starts as fast as through
   * the gateway while most of its bytes still come from Sia. Ignored without a
   * viewer session, where everything goes through the gateway.
   */
  siaDelivery?: 'direct' | 'hybrid';
  /** Tuning for `siaDelivery="hybrid"`; see `HybridPolicy` for the defaults. */
  hybridPolicy?: Partial<HybridPolicy>;
  /**
   * How bytes reach the player for this load: `sia` streams straight from Sia
   * hosts through the viewer session, `hybrid` splits segments between the
   * gateway and Sia (`siaDelivery="hybrid"`), `gateway` goes through the HTTP
   * gateway (no viewer key, Safari's native path, or a failed Sia session).
   */
  onDeliveryChange?: (mode: 'sia' | 'hybrid' | 'gateway') => void;
  /** Under hybrid delivery, where the segments came from so far; called after every segment. */
  onDeliveryStats?: (stats: HybridDeliveryStats) => void;
  onStateChange?: (state: PlayerState) => void;
}

export interface UseVideoReturn {
  /** Start playback. A rejection (such as an autoplay block) is ignored and `isPlaying` stays false. */
  play: () => void;
  pause: () => void;
  /** Seek to a time in seconds, clamped to 0 and, once known, the duration. */
  seek: (time: number) => void;
  /** Pin a rendition by its `index`, or pass -1 (or any index out of range) for adaptive. */
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
