import { useEffect, useState } from 'react';

export interface VideoMeta {
  /** the frame height, as the "1080p" people know */
  height: number;
  durationMs: number;
}

/**
 * The picked file's height and length, read from its header by the browser's
 * own video element before anything is sent. A file the browser cannot play
 * (an mkv in safari, an avi anywhere) has no answer, and the details only
 * show its size then.
 */
export function useVideoMeta(file: File): VideoMeta | null {
  const [meta, setMeta] = useState<{ file: File; value: VideoMeta } | null>(null);

  useEffect(() => {
    // jsdom and old browsers have no object urls for files
    if (typeof URL.createObjectURL !== 'function') return;
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    const done = () => {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    };
    video.onloadedmetadata = () => {
      const durationMs = Number.isFinite(video.duration) ? video.duration * 1000 : NaN;
      if (video.videoHeight > 0 && durationMs > 0) {
        setMeta({ file, value: { height: video.videoHeight, durationMs } });
      }
      done();
    };
    // an unplayable file only means there is nothing more to show
    video.onerror = done;
    video.src = url;
    return done;
  }, [file]);

  return meta?.file === file ? meta.value : null;
}
