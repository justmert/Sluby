import { useState, useEffect, useCallback, useRef } from 'react';
import type Hls from 'hls.js';
import type { QualityLevel, UseVideoReturn } from '../types.js';

/**
 * Headless video control hook.
 *
 * Wraps a <video> element ref and an optional hls.js instance ref to expose a
 * consistent, declarative API for controlling playback, tracking state, and
 * managing quality levels.
 */
export function useVideo(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  hlsRef: React.RefObject<Hls | null>,
): UseVideoReturn {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [qualities, setQualities] = useState<QualityLevel[]>([]);
  const [currentQuality, setCurrentQuality] = useState<QualityLevel | null>(
    null,
  );

  // Use a ref for the RAF id so we can cancel it on cleanup.
  const rafIdRef = useRef<number | null>(null);

  // ── Video element event listeners ────────────────────────────────────────

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);

    const onDurationChange = () => {
      if (video.duration && Number.isFinite(video.duration)) {
        setDuration(video.duration);
      }
    };

    const onTimeUpdate = () => {
      setCurrentTime(video.currentTime);
    };

    const onVolumeChange = () => {
      setVolumeState(video.muted ? 0 : video.volume);
    };

    const onWaiting = () => setIsBuffering(true);
    const onPlaying = () => setIsBuffering(false);
    const onCanPlay = () => setIsBuffering(false);
    const onSeeked = () => setIsBuffering(false);

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('ended', onEnded);
    video.addEventListener('durationchange', onDurationChange);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('volumechange', onVolumeChange);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('playing', onPlaying);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('seeked', onSeeked);

    // Initialise duration in case metadata is already loaded.
    if (video.duration && Number.isFinite(video.duration)) {
      setDuration(video.duration);
    }
    setVolumeState(video.muted ? 0 : video.volume);

    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('ended', onEnded);
      video.removeEventListener('durationchange', onDurationChange);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('volumechange', onVolumeChange);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('playing', onPlaying);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('seeked', onSeeked);
    };
  }, [videoRef]);

  // ── HLS quality level tracking ───────────────────────────────────────────

  useEffect(() => {
    const hls = hlsRef.current;
    if (!hls) return;

    // hls.js exposes Hls.Events as an enum, but we access them via the
    // instance's static events to stay version-safe.
    const HlsEvents = (hls.constructor as typeof Hls).Events;
    if (!HlsEvents) return;

    const onManifestParsed = () => {
      const levels = hls.levels.map(
        (level, index): QualityLevel => ({
          index,
          width: level.width,
          height: level.height,
          bitrate: level.bitrate,
          name: `${level.height}p`,
        }),
      );
      setQualities(levels);

      if (hls.currentLevel >= 0 && hls.currentLevel < levels.length) {
        setCurrentQuality(levels[hls.currentLevel]);
      }
    };

    const onLevelSwitched = (_event: string, data: { level: number }) => {
      const levels = hls.levels;
      if (data.level >= 0 && data.level < levels.length) {
        const level = levels[data.level];
        const quality: QualityLevel = {
          index: data.level,
          width: level.width,
          height: level.height,
          bitrate: level.bitrate,
          name: `${level.height}p`,
        };
        setCurrentQuality(quality);
      }
    };

    hls.on(HlsEvents.MANIFEST_PARSED, onManifestParsed);
    hls.on(HlsEvents.LEVEL_SWITCHED, onLevelSwitched);

    // If the manifest is already parsed (component hot-reloaded), seed levels.
    if (hls.levels.length > 0) {
      onManifestParsed();
    }

    return () => {
      hls.off(HlsEvents.MANIFEST_PARSED, onManifestParsed);
      hls.off(HlsEvents.LEVEL_SWITCHED, onLevelSwitched);
    };
  }, [hlsRef]);

  // ── Control methods ──────────────────────────────────────────────────────

  const play = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.play().catch(() => {
      // Autoplay may be blocked; ignore so the caller can handle via onError.
    });
  }, [videoRef]);

  const pause = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
  }, [videoRef]);

  const seek = useCallback(
    (time: number) => {
      const video = videoRef.current;
      if (!video) return;
      const clampedTime = Math.max(0, Math.min(time, video.duration || 0));
      video.currentTime = clampedTime;
    },
    [videoRef],
  );

  const setVolume = useCallback(
    (vol: number) => {
      const video = videoRef.current;
      if (!video) return;
      const clamped = Math.max(0, Math.min(1, vol));
      video.volume = clamped;
      video.muted = clamped === 0;
    },
    [videoRef],
  );

  const setQuality = useCallback(
    (levelIndex: number) => {
      const hls = hlsRef.current;
      if (!hls) return;
      // -1 is a special value in hls.js meaning "auto".
      hls.currentLevel = levelIndex;
    },
    [hlsRef],
  );

  // ── Cleanup animation frame on unmount ───────────────────────────────────

  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, []);

  return {
    play,
    pause,
    seek,
    setQuality,
    qualities,
    currentQuality,
    duration,
    currentTime,
    isPlaying,
    isBuffering,
    volume,
    setVolume,
  };
}
