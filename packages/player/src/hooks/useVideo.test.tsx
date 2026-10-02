import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type Hls from 'hls.js';
import { useVideo } from './useVideo.js';

/** A minimal hls.js stand-in with its own event bus. */
function fakeHls(levels: Array<{ width: number; height: number; bitrate: number }>) {
  const handlers = new Map<string, (event: string, data?: unknown) => void>();
  class FakeHls {
    static Events = { MANIFEST_PARSED: 'parsed', LEVEL_SWITCHED: 'switched' };
    levels = levels;
    currentLevel = -1;
    on(event: string, fn: (event: string, data?: unknown) => void) {
      handlers.set(event, fn);
    }
    off(event: string) {
      handlers.delete(event);
    }
  }
  return {
    hls: new FakeHls() as unknown as Hls,
    emit: (event: string, data?: unknown) => handlers.get(event)?.(event, data),
  };
}

describe('useVideo', () => {
  it('picks up an hls instance created after mount', () => {
    const video = document.createElement('video');
    const videoRef = { current: video };
    const hlsRef: { current: Hls | null } = { current: null };
    const { result } = renderHook(() => useVideo(videoRef, hlsRef));
    expect(result.current.qualities).toEqual([]);

    // the player creates hls.js later, then the video starts loading media
    const { hls, emit } = fakeHls([{ width: 1920, height: 1080, bitrate: 6_000_000 }]);
    hlsRef.current = hls;
    act(() => {
      video.dispatchEvent(new Event('loadstart'));
    });
    act(() => emit('parsed'));

    expect(result.current.qualities).toEqual([
      { index: 0, width: 1920, height: 1080, bitrate: 6_000_000, name: '1080p' },
    ]);

    act(() => emit('switched', { level: 0 }));
    expect(result.current.currentQuality?.name).toBe('1080p');
  });

  it('moves to a replacement instance after a retry', () => {
    const video = document.createElement('video');
    const first = fakeHls([{ width: 640, height: 360, bitrate: 800_000 }]);
    const videoRef = { current: video };
    const hlsRef: { current: Hls | null } = { current: first.hls };
    const { result } = renderHook(() => useVideo(videoRef, hlsRef));
    act(() => first.emit('parsed'));
    expect(result.current.qualities).toHaveLength(1);

    const second = fakeHls([
      { width: 1280, height: 720, bitrate: 3_500_000 },
      { width: 640, height: 360, bitrate: 800_000 },
    ]);
    hlsRef.current = second.hls;
    act(() => {
      video.dispatchEvent(new Event('loadstart'));
    });
    expect(result.current.qualities).toHaveLength(2);
  });
});
