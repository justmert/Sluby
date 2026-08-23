import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from 'react';
import Hls from 'hls.js';
import type { HlsConfig } from 'hls.js';
import type { SlubyPlayerProps, QualityLevel, PlayerState } from './types.js';

// ---------------------------------------------------------------------------
// Public imperative handle exposed via ref
// ---------------------------------------------------------------------------

export interface SlubyPlayerHandle {
  /** The underlying HTMLVideoElement, or null before mount. */
  getVideoElement: () => HTMLVideoElement | null;
  /** The underlying hls.js instance, or null when using native playback. */
  getHlsInstance: () => Hls | null;
}

// ---------------------------------------------------------------------------
// Defaults & helpers
// ---------------------------------------------------------------------------

const DEFAULT_MAX_NETWORK_RETRIES = 3;
const DEFAULT_MAX_MEDIA_RETRIES = 2;
// Incremental backoff (ms) before re-attempting a load after a network error.
const NETWORK_RETRY_BACKOFF_MS = 1000;

function toQualityLevel(
  level: { width: number; height: number; bitrate: number },
  index: number,
): QualityLevel {
  return {
    index,
    width: level.width,
    height: level.height,
    bitrate: level.bitrate,
    name: `${level.height}p`,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * `<SlubyPlayer>` -- a production React component for playing HLS streams
 * stored on Sia.
 *
 * Provide either a `src` (absolute HLS master manifest URL) or a `client`
 * (a `SlubyClient`) plus `assetId`, in which case the player resolves the
 * delivery URL itself. Segments are fetched directly from Sia-backed delivery.
 *
 * Features: adaptive quality (hls.js), Safari native HLS fallback, bounded
 * automatic error recovery, and loading / error states with an optional
 * built-in overlay.
 */
export const SlubyPlayer = forwardRef<SlubyPlayerHandle, SlubyPlayerProps>(
  function SlubyPlayer(props, ref) {
    const {
      src,
      client,
      assetId,
      signed = false,
      expiresIn,
      poster,
      autoPlay = false,
      controls = true,
      muted = false,
      width,
      height,
      className,
      style,
      overlay = true,
      maxNetworkRetries = DEFAULT_MAX_NETWORK_RETRIES,
      maxMediaRetries = DEFAULT_MAX_MEDIA_RETRIES,
      onReady,
      onPlay,
      onPause,
      onEnd,
      onError,
      onQualityChange,
      onStateChange,
    } = props;

    const videoRef = useRef<HTMLVideoElement | null>(null);
    const hlsRef = useRef<Hls | null>(null);
    // Set once we have reported a terminal (given-up) error, so a follow-on
    // native <video> error event cannot overwrite the authoritative message.
    const terminalRef = useRef(false);

    const [state, setState] = useState<PlayerState>('idle');
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [resolvedSrc, setResolvedSrc] = useState<string | null>(src ?? null);
    const [resolvedPoster, setResolvedPoster] = useState<string | undefined>(poster);
    const [retryKey, setRetryKey] = useState(0);

    // Keep the latest callbacks in refs so the HLS effect does not re-run (and
    // tear down playback) every time a parent re-renders with new closures.
    const cb = useRef({ onReady, onPlay, onPause, onEnd, onError, onQualityChange, onStateChange });
    useEffect(() => {
      cb.current = { onReady, onPlay, onPause, onEnd, onError, onQualityChange, onStateChange };
    });

    // ── State transitions notify the consumer once, on change ──────────────

    useEffect(() => {
      cb.current.onStateChange?.(state);
    }, [state]);

    const fail = useCallback((message: string) => {
      setErrorMessage(message);
      setState('error');
      cb.current.onError?.(new Error(message));
    }, []);

    // ── Resolve src from (client + assetId) when no explicit src is given ───

    useEffect(() => {
      if (src) {
        setResolvedSrc(src);
        return;
      }
      if (!client || !assetId) {
        setResolvedSrc(null);
        return;
      }

      let cancelled = false;
      setState('loading');

      (async () => {
        try {
          if (signed) {
            const { signedUrl } = await client.playback.getSignedUrl(assetId, { expiresIn });
            if (!cancelled) setResolvedSrc(signedUrl);
          } else {
            const info = await client.playback.getUrl(assetId);
            if (cancelled) return;
            setResolvedSrc(info.playbackUrl);
            if (!poster && info.posterUrl) setResolvedPoster(info.posterUrl);
          }
        } catch (err) {
          if (!cancelled) {
            fail(err instanceof Error ? err.message : 'Failed to resolve playback URL');
          }
        }
      })();

      return () => {
        cancelled = true;
      };
      // `retryKey` is included so the overlay Retry button re-runs a failed
      // resolution. `poster` is intentionally excluded (a dedicated effect
      // handles poster changes) so updating it does not re-mint a signed URL.
    }, [src, client, assetId, signed, expiresIn, retryKey, fail]);

    useEffect(() => {
      if (poster) setResolvedPoster(poster);
    }, [poster]);

    // ── Imperative handle ──────────────────────────────────────────────────

    useImperativeHandle(
      ref,
      () => ({
        getVideoElement: () => videoRef.current,
        getHlsInstance: () => hlsRef.current,
      }),
      [],
    );

    // ── Video element event forwarding ─────────────────────────────────────

    const handlePlay = useCallback(() => cb.current.onPlay?.(), []);
    const handlePause = useCallback(() => cb.current.onPause?.(), []);
    const handleEnded = useCallback(() => cb.current.onEnd?.(), []);
    const handleWaiting = useCallback(() => {
      setState((s) => (s === 'error' ? s : 'buffering'));
    }, []);
    const handlePlaying = useCallback(() => {
      setState((s) => (s === 'error' ? s : 'ready'));
    }, []);
    const handleVideoError = useCallback(() => {
      const video = videoRef.current;
      const mediaError = video?.error;
      // A terminal HLS error already reported the authoritative message; a
      // native error from MSE detaching afterwards must not overwrite it.
      if (terminalRef.current) return;
      // hls.js surfaces its own errors; only report a native <video> error when
      // we are not driving playback through hls.js (Safari native path).
      if (hlsRef.current) return;
      const message = mediaError
        ? `MediaError code ${mediaError.code}: ${mediaError.message || 'Unknown media error'}`
        : 'Unknown video error';
      fail(message);
    }, [fail]);

    // ── HLS initialisation & lifecycle ─────────────────────────────────────

    useEffect(() => {
      const video = videoRef.current;
      if (!video || !resolvedSrc) return;

      setErrorMessage(null);
      setState('loading');
      terminalRef.current = false;

      // ------------------------------------------------------------------
      // Native HLS support (e.g. Safari on macOS / iOS)
      // ------------------------------------------------------------------
      if (!Hls.isSupported() && video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = resolvedSrc;

        const onNativeLoaded = () => {
          setState('ready');
          cb.current.onReady?.();
          if (autoPlay) {
            video.play().catch(() => {
              /* autoplay policy may block */
            });
          }
        };
        video.addEventListener('loadedmetadata', onNativeLoaded, { once: true });

        return () => {
          video.removeEventListener('loadedmetadata', onNativeLoaded);
          video.removeAttribute('src');
          video.load();
        };
      }

      // ------------------------------------------------------------------
      // hls.js path
      // ------------------------------------------------------------------
      if (!Hls.isSupported()) {
        fail('HLS is not supported in this browser and native HLS is unavailable.');
        return;
      }

      const hlsConfig: Partial<HlsConfig> = {
        enableWorker: true,
        lowLatencyMode: false,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        maxBufferSize: 60 * 1000 * 1000,
        maxBufferHole: 0.5,
        startLevel: -1, // auto (adaptive)
      };

      const hls = new Hls(hlsConfig);
      hlsRef.current = hls;

      // Bounded recovery counters. Reset once real data buffers so that
      // intermittent, well-separated errors do not exhaust the budget.
      let networkRetries = 0;
      let mediaRetries = 0;
      let backoffTimer: ReturnType<typeof setTimeout> | null = null;
      let destroyed = false;

      // Tear down after an unrecoverable error, exactly once: cancel any pending
      // reload so its callback cannot fire on a destroyed instance, mark the
      // error terminal, destroy, and report.
      const giveUp = (message: string) => {
        if (backoffTimer) clearTimeout(backoffTimer);
        destroyed = true;
        terminalRef.current = true;
        hls.destroy();
        hlsRef.current = null;
        fail(message);
      };

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (hls.currentLevel >= 0 && hls.currentLevel < hls.levels.length) {
          cb.current.onQualityChange?.(
            toQualityLevel(hls.levels[hls.currentLevel], hls.currentLevel),
          );
        }
        setState('ready');
        cb.current.onReady?.();
        if (autoPlay) {
          video.play().catch(() => {
            /* autoplay policy may block */
          });
        }
      });

      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        // Real media is flowing; forgive earlier transient errors.
        networkRetries = 0;
        mediaRetries = 0;
      });

      hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
        const level = hls.levels[data.level];
        if (level) cb.current.onQualityChange?.(toQualityLevel(level, data.level));
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return; // non-fatal errors are auto-handled by hls.js

        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            if (networkRetries < maxNetworkRetries) {
              networkRetries += 1;
              setState('buffering');
              if (backoffTimer) clearTimeout(backoffTimer);
              backoffTimer = setTimeout(
                () => hls.startLoad(),
                NETWORK_RETRY_BACKOFF_MS * networkRetries,
              );
            } else {
              giveUp(
                `Network error, gave up after ${maxNetworkRetries} retries (${data.details}).`,
              );
            }
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            if (mediaRetries < maxMediaRetries) {
              mediaRetries += 1;
              setState('buffering');
              hls.recoverMediaError();
            } else {
              giveUp(`Media error, gave up after ${maxMediaRetries} retries (${data.details}).`);
            }
            break;
          default:
            giveUp(`Fatal HLS error: ${data.type} / ${data.details}`);
            break;
        }
      });

      hls.attachMedia(video);
      hls.loadSource(resolvedSrc);

      return () => {
        if (backoffTimer) clearTimeout(backoffTimer);
        // A give-up already destroyed the instance; do not destroy twice.
        if (!destroyed) hls.destroy();
        hlsRef.current = null;
      };
    }, [resolvedSrc, retryKey, autoPlay, maxNetworkRetries, maxMediaRetries, fail]);

    // ── Retry (from the overlay button) ────────────────────────────────────

    const handleRetry = useCallback(() => {
      setErrorMessage(null);
      setState('loading');
      setRetryKey((k) => k + 1);
    }, []);

    // ── Render ─────────────────────────────────────────────────────────────

    const showSpinner = overlay && (state === 'loading' || state === 'buffering');
    const showError = overlay && state === 'error';

    return (
      <div
        className={className}
        style={{ position: 'relative', display: 'inline-block', width, height, ...style }}
      >
        <style>{SPINNER_CSS}</style>
        <video
          ref={videoRef}
          poster={resolvedPoster}
          controls={controls}
          muted={muted}
          width={width}
          height={height}
          style={{ display: 'block', width: '100%', height: '100%' }}
          playsInline
          onPlay={handlePlay}
          onPause={handlePause}
          onEnded={handleEnded}
          onWaiting={handleWaiting}
          onPlaying={handlePlaying}
          onError={handleVideoError}
        />

        {showSpinner && (
          <div style={OVERLAY_STYLE} data-sluby-overlay="loading">
            <div className="sluby-spinner" />
          </div>
        )}

        {showError && (
          <div style={OVERLAY_STYLE} data-sluby-overlay="error">
            <div style={{ textAlign: 'center', color: '#fff', padding: 16 }}>
              <div style={{ marginBottom: 12, fontSize: 14 }}>
                {errorMessage ?? 'Playback error'}
              </div>
              <button type="button" onClick={handleRetry} style={RETRY_BUTTON_STYLE}>
                Retry
              </button>
            </div>
          </div>
        )}
      </div>
    );
  },
);

// ---------------------------------------------------------------------------
// Inline overlay styling (dependency-free)
// ---------------------------------------------------------------------------

const OVERLAY_STYLE: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(0, 0, 0, 0.45)',
  pointerEvents: 'none',
};

const RETRY_BUTTON_STYLE: React.CSSProperties = {
  pointerEvents: 'auto',
  cursor: 'pointer',
  padding: '8px 16px',
  fontSize: 14,
  color: '#000',
  background: '#fff',
  border: 'none',
  borderRadius: 4,
};

const SPINNER_CSS = `
.sluby-spinner {
  width: 42px;
  height: 42px;
  border: 4px solid rgba(255, 255, 255, 0.25);
  border-top-color: #fff;
  border-radius: 50%;
  animation: sluby-spin 0.8s linear infinite;
}
@keyframes sluby-spin { to { transform: rotate(360deg); } }
`;
