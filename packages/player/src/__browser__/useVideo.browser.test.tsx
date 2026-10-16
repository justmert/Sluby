// useVideo against a real hls.js instance and a real <video> in Chromium. The
// host component creates hls.js in its own effect, after the hook's effects
// ran with an empty ref, which is how SlubyPlayer uses it too: the hook has to
// pick the instance up from the media element's loadstart/loadedmetadata.

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { useEffect, useRef } from 'react';
import Hls from 'hls.js';
import { useVideo } from '../hooks/useVideo.js';
import type { UseVideoReturn } from '../types.js';
import {
  getCatalog,
  mount,
  objectUrl,
  resetGateway,
  type FixtureCatalog,
  type Mounted,
} from './harness.js';

let catalog: FixtureCatalog;
let mounted: Mounted | null = null;

beforeAll(async () => {
  catalog = await getCatalog();
});

beforeEach(async () => {
  await resetGateway();
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function Host({
  src,
  latest,
}: {
  src: string;
  latest: { api: UseVideoReturn | null; video: HTMLVideoElement | null };
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const api = useVideo(videoRef, hlsRef);
  latest.api = api;

  useEffect(() => {
    const video = videoRef.current!;
    latest.video = video;
    const hls = new Hls();
    hlsRef.current = hls;
    hls.attachMedia(video);
    hls.loadSource(src);
    return () => {
      hls.destroy();
      hlsRef.current = null;
    };
  }, [src, latest]);

  return <video ref={videoRef} muted playsInline />;
}

describe('useVideo with real hls.js', () => {
  it('tracks levels, playback, quality, seeking, and volume from the real element', async () => {
    const latest: { api: UseVideoReturn | null; video: HTMLVideoElement | null } = {
      api: null,
      video: null,
    };
    mounted = mount(<Host src={objectUrl(catalog.masterId)} latest={latest} />);
    const api = () => latest.api!;
    const wait = (fn: () => void) => vi.waitFor(fn, { timeout: 15_000, interval: 50 });

    await wait(() => {
      expect(api().qualities.map((q) => [q.index, q.width, q.height, q.name])).toEqual([
        [0, 256, 144, '144p'],
        [1, 426, 240, '240p'],
      ]);
      expect(api().currentQuality).not.toBeNull();
      expect(api().duration).toBeCloseTo(3, 0);
    });
    expect(api().isPlaying).toBe(false);

    api().play();
    await wait(() => {
      expect(api().isPlaying).toBe(true);
      expect(api().currentTime).toBeGreaterThan(0.3);
    });

    const target = api().currentQuality!.index === 0 ? 1 : 0;
    api().setQuality(target);
    await wait(() => expect(api().currentQuality?.index).toBe(target));
    expect(api().currentQuality?.height).toBe(target === 0 ? 144 : 240);

    api().pause();
    await wait(() => expect(api().isPlaying).toBe(false));

    api().seek(2);
    await wait(() => expect(latest.video!.currentTime).toBeCloseTo(2, 1));
    // seeking past the end clamps to the duration
    api().seek(1000);
    expect(latest.video!.currentTime).toBeLessThanOrEqual(latest.video!.duration);

    api().setVolume(0);
    await wait(() => expect(api().volume).toBe(0));
    expect(latest.video!.muted).toBe(true);
    api().setVolume(0.5);
    await wait(() => expect(api().volume).toBe(0.5));
    expect(latest.video!.muted).toBe(false);
  });
});
