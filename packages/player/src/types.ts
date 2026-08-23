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
}

export interface SlubyPlayerProps {
  /**
   * Absolute HLS master manifest URL. Provide this, or `client` + `assetId`
   * to have the player resolve the URL from the SDK.
   */
  src?: string;
  /** A `SlubyClient` (or compatible resolver) used to resolve `assetId`. */
  client?: PlaybackResolver;
  /** Asset id to resolve into a playback URL via `client`. */
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
  onQualityChange?: (level: QualityLevel) => void;
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
