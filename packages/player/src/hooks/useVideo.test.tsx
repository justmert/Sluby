import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type Hls from 'hls.js';
import type { SlubyPlayerHandle } from '../SlubyPlayer.js';
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

  it('clears the levels when the hls instance goes away', () => {
    const video = document.createElement('video');
    const { hls, emit } = fakeHls([{ width: 640, height: 360, bitrate: 800_000 }]);
    const videoRef = { current: video };
    const hlsRef: { current: Hls | null } = { current: hls };
    const { result } = renderHook(() => useVideo(videoRef, hlsRef));
    act(() => emit('parsed'));
    act(() => emit('switched', { level: 0 }));
    expect(result.current.qualities).toHaveLength(1);

    // the player destroyed it (a give-up), which empties the element
    hlsRef.current = null;
    act(() => {
      video.dispatchEvent(new Event('emptied'));
    });

    expect(result.current.qualities).toEqual([]);
    expect(result.current.currentQuality).toBeNull();
  });

  it('follows a video element that appears after the first render', () => {
    const videoRef: { current: HTMLVideoElement | null } = { current: null };
    const hlsRef: { current: Hls | null } = { current: null };
    const { result, rerender } = renderHook(() => useVideo(videoRef, hlsRef));

    const video = document.createElement('video');
    videoRef.current = video;
    rerender();
    Object.defineProperty(video, 'duration', { value: 42, configurable: true });
    act(() => {
      video.dispatchEvent(new Event('durationchange'));
    });

    expect(result.current.duration).toBe(42);
  });

  it('takes a SlubyPlayer handle ref and reads the current element and instance from it', () => {
    const video = document.createElement('video');
    let current: Hls | null = null;
    const handle: SlubyPlayerHandle = {
      getVideoElement: () => video,
      getHlsInstance: () => current,
      getQualities: () => [],
      setQuality: () => {},
      isAutoQuality: () => true,
    };
    const playerRef = { current: handle };
    const { result } = renderHook(() => useVideo(playerRef));

    // the player builds a new instance per load; the hook must not keep a stale one
    const { hls, emit } = fakeHls([{ width: 1280, height: 720, bitrate: 3_000_000 }]);
    current = hls;
    act(() => {
      video.dispatchEvent(new Event('loadstart'));
    });
    act(() => emit('parsed'));
    expect(result.current.qualities).toHaveLength(1);

    act(() => result.current.setQuality(0));
    expect((hls as unknown as { currentLevel: number }).currentLevel).toBe(0);
  });
});
