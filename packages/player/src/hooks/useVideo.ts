import { useState, useEffect, useCallback, type RefObject } from 'react';
import type Hls from 'hls.js';
import type { SlubyPlayerHandle } from '../SlubyPlayer.js';
import type { QualityLevel, UseVideoReturn } from '../types.js';
import { toQualityLevel } from '../quality.js';

function toQualities(hls: Hls): QualityLevel[] {
  return hls.levels.map((level, index) => toQualityLevel(level, index));
}

/**
 * Headless video control hook.
 *
 * Pass the ref of a `<SlubyPlayer>` to build custom controls for it:
 *
 * ```tsx
 * const player = useRef<SlubyPlayerHandle>(null);
 * const video = useVideo(player);
 * <SlubyPlayer ref={player} ... />
 * ```
 *
 * Or pass a `<video>` ref and an hls.js instance ref for a player of your own.
 * Either way the hook follows the element once it mounts and every hls.js
 * instance attached to it (the player makes a new one per load), and exposes
 * a declarative API for controlling playback, tracking state, and managing
 * quality levels.
 */
export function useVideo(player: RefObject<SlubyPlayerHandle | null>): UseVideoReturn;
export function useVideo(
  videoRef: RefObject<HTMLVideoElement | null>,
  hlsRef: RefObject<Hls | null>,
): UseVideoReturn;
export function useVideo(
  ref: RefObject<SlubyPlayerHandle | null> | RefObject<HTMLVideoElement | null>,
  hlsRef?: RefObject<Hls | null>,
): UseVideoReturn {
  // read through the refs on every call: a ref is filled after the render
  // that created it, and the player swaps its hls.js instance on each load
  const getVideo = useCallback((): HTMLVideoElement | null => {
    if (hlsRef) return (ref as RefObject<HTMLVideoElement | null>).current;
    return (ref as RefObject<SlubyPlayerHandle | null>).current?.getVideoElement() ?? null;
  }, [ref, hlsRef]);
  const getHls = useCallback((): Hls | null => {
    if (hlsRef) return hlsRef.current;
    return (ref as RefObject<SlubyPlayerHandle | null>).current?.getHlsInstance() ?? null;
  }, [ref, hlsRef]);

  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [qualities, setQualities] = useState<QualityLevel[]>([]);
  const [currentQuality, setCurrentQuality] = useState<QualityLevel | null>(null);

  // pick up the element after every render, so a player mounted (or
  // remounted) after this hook's first run is still followed. it runs without
  // deps on purpose and only sets state when the element changed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const current = getVideo();
    if (current !== video) setVideo(current);
  });

  // ── Video element event listeners ────────────────────────────────────────

  useEffect(() => {
    if (!video) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => setIsPlaying(false);

    const onDurationChange = () => {
      setDuration(video.duration && Number.isFinite(video.duration) ? video.duration : 0);
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

    // the element may already be playing or have metadata
    onDurationChange();
    onTimeUpdate();
    onVolumeChange();
    setIsPlaying(!video.paused && !video.ended);

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
  }, [video]);

  // ── HLS quality level tracking ───────────────────────────────────────────
  //
  // The player creates its hls.js instance only after it resolves the source,
  // and a new one for every later load, so it is not there when this effect
  // first runs. Attaching or detaching hls.js resets the <video> (`emptied`,
  // then `loadstart`), so re-check on those events and follow whatever
  // instance is current, clearing the levels when there is none.

  useEffect(() => {
    let attached: Hls | null = null;
    let detach = () => {};

    const attach = () => {
      const hls = getHls();
      if (hls === attached) return;
      detach();
      detach = () => {};
      attached = hls;
      setQualities([]);
      setCurrentQuality(null);
      if (!hls) return;

      // hls.js exposes Hls.Events as an enum, but we access them via the
      // instance's static events to stay version-safe.
      const HlsEvents = (hls.constructor as typeof Hls).Events;
      if (!HlsEvents) return;

      const onManifestParsed = () => {
        const levels = toQualities(hls);
        setQualities(levels);
        if (hls.currentLevel >= 0 && hls.currentLevel < levels.length) {
          setCurrentQuality(levels[hls.currentLevel]);
        }
      };

      const onLevelSwitched = (_event: string, data: { level: number }) => {
        const levels = toQualities(hls);
        if (data.level >= 0 && data.level < levels.length) {
          setCurrentQuality(levels[data.level]);
        }
      };

      hls.on(HlsEvents.MANIFEST_PARSED, onManifestParsed);
      hls.on(HlsEvents.LEVEL_SWITCHED, onLevelSwitched);

      // The manifest may already be parsed by the time we attach.
      if (hls.levels.length > 0) {
        onManifestParsed();
      }

      detach = () => {
        hls.off(HlsEvents.MANIFEST_PARSED, onManifestParsed);
        hls.off(HlsEvents.LEVEL_SWITCHED, onLevelSwitched);
      };
    };

    attach();
    video?.addEventListener('emptied', attach);
    video?.addEventListener('loadstart', attach);
    video?.addEventListener('loadedmetadata', attach);

    return () => {
      video?.removeEventListener('emptied', attach);
      video?.removeEventListener('loadstart', attach);
      video?.removeEventListener('loadedmetadata', attach);
      detach();
    };
  }, [video, getHls]);

  // ── Control methods ──────────────────────────────────────────────────────

  const play = useCallback(() => {
    const current = getVideo();
    if (!current) return;
    current.play().catch(() => {
      // an autoplay block or an interrupted load; isPlaying stays false
    });
  }, [getVideo]);

  const pause = useCallback(() => {
    getVideo()?.pause();
  }, [getVideo]);

  const seek = useCallback(
    (time: number) => {
      const current = getVideo();
      if (!current) return;
      // before metadata the duration is unknown, so only the lower bound applies
      const upper =
        Number.isFinite(current.duration) && current.duration > 0 ? current.duration : Infinity;
      current.currentTime = Math.max(0, Math.min(time, upper));
    },
    [getVideo],
  );

  const setVolume = useCallback(
    (vol: number) => {
      const current = getVideo();
      if (!current) return;
      const clamped = Math.max(0, Math.min(1, vol));
      current.volume = clamped;
      current.muted = clamped === 0;
    },
    [getVideo],
  );

  const setQuality = useCallback(
    (levelIndex: number) => {
      const hls = getHls();
      if (!hls) return;
      // -1 hands the choice back to hls.js's abr controller
      hls.currentLevel = levelIndex >= 0 && levelIndex < hls.levels.length ? levelIndex : -1;
    },
    [getHls],
  );

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
