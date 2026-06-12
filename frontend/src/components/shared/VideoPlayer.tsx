import { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import type { HlsConfig } from 'hls.js';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';

export interface VideoPlayerProps {
  src: string;
  poster?: string;
  autoPlay?: boolean;
  controls?: boolean;
  onReady?: () => void;
  onPlay?: () => void;
  onPause?: () => void;
  onEnd?: () => void;
  onError?: (error: Error) => void;
  onQualityChange?: (quality: { index: number; height: number; bitrate: number; name: string }) => void;
  className?: string;
}

interface QualityLevel {
  index: number;
  height: number;
  bitrate: number;
  name: string;
}

export function VideoPlayer({
  src,
  poster,
  autoPlay = false,
  controls = true,
  onReady,
  onPlay,
  onPause,
  onEnd,
  onError,
  onQualityChange,
  className,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [qualities, setQualities] = useState<QualityLevel[]>([]);
  const [currentQuality, setCurrentQuality] = useState(-1);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  const handleRetry = useCallback(() => {
    setError(null);
    const hls = hlsRef.current;
    if (hls) {
      hls.startLoad();
    } else if (videoRef.current) {
      videoRef.current.load();
    }
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    // --- Native HLS (Safari) ---
    if (!Hls.isSupported() && video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
      const onLoaded = () => onReady?.();
      video.addEventListener('loadedmetadata', onLoaded, { once: true });
      if (autoPlay) {
        video.play().catch(() => {});
      }
      return () => {
        video.removeEventListener('loadedmetadata', onLoaded);
        video.removeAttribute('src');
        video.load();
      };
    }

    // --- hls.js ---
    if (!Hls.isSupported()) {
      const msg = 'HLS playback is not supported in this browser.';
      setError(msg);
      onError?.(new Error(msg));
      return;
    }

    const hlsConfig: Partial<HlsConfig> = {
      enableWorker: true,
      lowLatencyMode: false,
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      maxBufferSize: 60 * 1000 * 1000,
      maxBufferHole: 0.5,
      startLevel: -1,
    };

    const hls = new Hls(hlsConfig);
    hlsRef.current = hls;

    hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
      const levels: QualityLevel[] = data.levels.map((level, i) => ({
        index: i,
        height: level.height,
        bitrate: level.bitrate,
        name: `${level.height}p`,
      }));
      setQualities(levels);
      onReady?.();

      if (autoPlay) {
        video.play().catch(() => {});
      }
    });

    hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
      const level = hls.levels[data.level];
      if (level) {
        const ql: QualityLevel = {
          index: data.level,
          height: level.height,
          bitrate: level.bitrate,
          name: `${level.height}p`,
        };
        setCurrentQuality(data.level);
        onQualityChange?.(ql);
      }
    });

    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            hls.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            hls.recoverMediaError();
            break;
          default: {
            const msg = `Playback error: ${data.details}`;
            setError(msg);
            hls.destroy();
            onError?.(new Error(msg));
            break;
          }
        }
      }
    });

    hls.attachMedia(video);
    hls.loadSource(src);

    return () => {
      hls.destroy();
      hlsRef.current = null;
    };
  }, [src, autoPlay, onReady, onError, onQualityChange]);

  const handleQualityChange = useCallback(
    (levelIndex: number) => {
      const hls = hlsRef.current;
      if (hls) {
        hls.currentLevel = levelIndex;
      }
    },
    [],
  );

  const handleSpeedChange = useCallback((speed: number) => {
    setPlaybackSpeed(speed);
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
  }, []);

  return (
    <div className={cn('relative w-full aspect-video bg-black rounded-xl overflow-hidden border border-white/[0.08]', className)}>
      <video
        ref={videoRef}
        poster={poster}
        controls={controls}
        playsInline
        onPlay={() => onPlay?.()}
        onPause={() => onPause?.()}
        onEnded={() => onEnd?.()}
        className="h-full w-full"
      />

      {/* Quality & speed selectors */}
      {!error && (
        <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
          {/* Playback speed */}
          <select
            value={playbackSpeed}
            onChange={(e) => handleSpeedChange(Number(e.target.value))}
            className="rounded-lg bg-black/60 px-2.5 py-1.5 text-xs text-white border border-white/[0.08] backdrop-blur-xl cursor-pointer transition-all duration-200 hover:bg-black/70"
          >
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map((s) => (
              <option key={s} value={s}>
                {s}x
              </option>
            ))}
          </select>

          {/* Quality */}
          {qualities.length > 1 && (
            <select
              value={currentQuality}
              onChange={(e) => handleQualityChange(Number(e.target.value))}
              className="rounded-lg bg-black/60 px-2.5 py-1.5 text-xs text-white border border-white/[0.08] backdrop-blur-xl cursor-pointer transition-all duration-200 hover:bg-black/70"
            >
              <option value={-1}>Auto</option>
              {qualities.map((q) => (
                <option key={q.index} value={q.index}>
                  {q.name}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Error overlay */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4 rounded-xl border border-red-500/20 bg-red-950/40 p-8 text-center max-w-sm backdrop-blur-xl">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/10">
              <AlertCircle className="h-6 w-6 text-red-400" />
            </div>
            <p className="text-sm text-red-200">{error}</p>
            <Button variant="outline" size="sm" onClick={handleRetry}>
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
