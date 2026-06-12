import React, {
  useEffect,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from 'react';
import Hls from 'hls.js';
import type { HlsConfig } from 'hls.js';
import type { SiaStreamPlayerProps, QualityLevel } from './types.js';

// ---------------------------------------------------------------------------
// Public imperative handle exposed via ref
// ---------------------------------------------------------------------------

export interface SiaStreamPlayerHandle {
  /** The underlying HTMLVideoElement, or null before mount. */
  getVideoElement: () => HTMLVideoElement | null;
  /** The underlying hls.js instance, or null when using native playback. */
  getHlsInstance: () => Hls | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a quality-level descriptor from an hls.js level object.
 */
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
 * `<SiaStreamPlayer>` -- a drop-in React component for playing HLS streams
 * stored on Sia.
 *
 * Simply pass a `src` URL pointing to the HLS master manifest.
 *
 * The component can be controlled imperatively via a ref that exposes the
 * underlying `<video>` element and the hls.js instance.
 */
export const SiaStreamPlayer = forwardRef<
  SiaStreamPlayerHandle,
  SiaStreamPlayerProps
>(function SiaStreamPlayer(props, ref) {
  const {
    src,
    poster,
    autoPlay = false,
    controls = true,
    width,
    height,
    className,
    style,
    onReady,
    onPlay,
    onPause,
    onEnd,
    onError,
    onQualityChange,
  } = props;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

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

  const handlePlay = useCallback(() => onPlay?.(), [onPlay]);
  const handlePause = useCallback(() => onPause?.(), [onPause]);
  const handleEnded = useCallback(() => onEnd?.(), [onEnd]);
  const handleVideoError = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const mediaError = video.error;
    const message = mediaError
      ? `MediaError code ${mediaError.code}: ${mediaError.message || 'Unknown media error'}`
      : 'Unknown video error';
    onError?.(new Error(message));
  }, [onError]);

  // ── HLS initialisation & lifecycle ─────────────────────────────────────

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    // ------------------------------------------------------------------
    // Native HLS support (e.g. Safari on macOS / iOS)
    // ------------------------------------------------------------------
    if (
      !Hls.isSupported() &&
      video.canPlayType('application/vnd.apple.mpegurl')
    ) {
      video.src = src;

      const onNativeLoaded = () => {
        onReady?.();
      };
      video.addEventListener('loadedmetadata', onNativeLoaded, {
        once: true,
      });

      if (autoPlay) {
        video.play().catch(() => {
          // Autoplay policy may block; ignore.
        });
      }

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
      onError?.(
        new Error(
          'HLS is not supported in this browser and native HLS is unavailable.',
        ),
      );
      return;
    }

    const hlsConfig: Partial<HlsConfig> = {
      enableWorker: true,
      lowLatencyMode: false,
      maxBufferLength: 30, // seconds
      maxMaxBufferLength: 60,
      maxBufferSize: 60 * 1000 * 1000, // 60 MB
      maxBufferHole: 0.5,
      startLevel: -1, // auto
    };

    const hls = new Hls(hlsConfig);
    hlsRef.current = hls;

    // ── hls.js events ──────────────────────────────────────────────────

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      // Notify the consumer about available quality levels.
      if (hls.currentLevel >= 0 && hls.currentLevel < hls.levels.length) {
        onQualityChange?.(toQualityLevel(hls.levels[hls.currentLevel], hls.currentLevel));
      }
      onReady?.();

      if (autoPlay) {
        video.play().catch(() => {
          // Autoplay policy may block; ignore.
        });
      }
    });

    hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
      const level = hls.levels[data.level];
      if (level) {
        onQualityChange?.(toQualityLevel(level, data.level));
      }
    });

    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            // Attempt recovery from network errors.
            hls.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            // Attempt recovery from media decode errors.
            hls.recoverMediaError();
            break;
          default:
            // Unrecoverable -- destroy and notify.
            hls.destroy();
            onError?.(
              new Error(
                `Fatal HLS error: ${data.type} / ${data.details}`,
              ),
            );
            break;
        }
      } else {
        // Non-fatal errors are usually transient; still surface them so
        // the consumer can log or display them.
        onError?.(
          new Error(`HLS error: ${data.type} / ${data.details}`),
        );
      }
    });

    hls.attachMedia(video);
    hls.loadSource(src);

    // ── Cleanup ────────────────────────────────────────────────────────

    return () => {
      hls.destroy();
      hlsRef.current = null;
    };
  }, [
    src,
    autoPlay,
    onReady,
    onError,
    onQualityChange,
  ]);

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <video
      ref={videoRef}
      poster={poster}
      controls={controls}
      width={width}
      height={height}
      className={className}
      style={style}
      playsInline
      onPlay={handlePlay}
      onPause={handlePause}
      onEnded={handleEnded}
      onError={handleVideoError}
    />
  );
});
