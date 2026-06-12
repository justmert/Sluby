import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useVideo } from './useVideo.js';

// ---------------------------------------------------------------------------
// Helpers: create a minimal mock video element
// ---------------------------------------------------------------------------

function createMockVideoElement(overrides?: Partial<HTMLVideoElement>): HTMLVideoElement {
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  const video = {
    duration: 0,
    currentTime: 0,
    volume: 1,
    muted: false,
    paused: true,
    error: null,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    addEventListener: vi.fn((event: string, listener: EventListenerOrEventListenerObject) => {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(listener);
    }),
    removeEventListener: vi.fn((event: string, listener: EventListenerOrEventListenerObject) => {
      listeners.get(event)?.delete(listener);
    }),
    // Helper to fire events
    _fireEvent: (eventName: string) => {
      const eventListeners = listeners.get(eventName);
      if (eventListeners) {
        eventListeners.forEach((listener) => {
          if (typeof listener === 'function') {
            listener(new Event(eventName));
          }
        });
      }
    },
    ...overrides,
  } as unknown as HTMLVideoElement & { _fireEvent: (e: string) => void };

  return video;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useVideo', () => {
  let mockVideo: HTMLVideoElement & { _fireEvent: (e: string) => void };
  let videoRef: { current: HTMLVideoElement | null };
  let hlsRef: { current: any };

  beforeEach(() => {
    mockVideo = createMockVideoElement() as any;
    videoRef = { current: mockVideo };
    hlsRef = { current: null };
  });

  describe('initial state', () => {
    it('should have correct default values', () => {
      const { result } = renderHook(() => useVideo(videoRef, hlsRef));

      expect(result.current.isPlaying).toBe(false);
      expect(result.current.isBuffering).toBe(false);
      expect(result.current.duration).toBe(0);
      expect(result.current.currentTime).toBe(0);
      expect(result.current.volume).toBe(1);
      expect(result.current.qualities).toEqual([]);
      expect(result.current.currentQuality).toBeNull();
    });

    it('should initialize duration from video element if already loaded', () => {
      mockVideo = createMockVideoElement({ duration: 120 } as any) as any;
      videoRef.current = mockVideo;

      const { result } = renderHook(() => useVideo(videoRef, hlsRef));

      expect(result.current.duration).toBe(120);
    });

    it('should initialize volume as 0 when video is muted', () => {
      mockVideo = createMockVideoElement({ muted: true } as any) as any;
      videoRef.current = mockVideo;

      const { result } = renderHook(() => useVideo(videoRef, hlsRef));

      expect(result.current.volume).toBe(0);
    });
  });

  describe('state tracking via events', () => {
    it('should set isPlaying to true on play event', () => {
      const { result } = renderHook(() => useVideo(videoRef, hlsRef));

      act(() => {
        mockVideo._fireEvent('play');
      });

      expect(result.current.isPlaying).toBe(true);
    });

    it('should set isPlaying to false on pause event', () => {
      const { result } = renderHook(() => useVideo(videoRef, hlsRef));

      act(() => {
        mockVideo._fireEvent('play');
      });
      expect(result.current.isPlaying).toBe(true);

      act(() => {
        mockVideo._fireEvent('pause');
      });
      expect(result.current.isPlaying).toBe(false);
    });

    it('should set isPlaying to false on ended event', () => {
      const { result } = renderHook(() => useVideo(videoRef, hlsRef));

      act(() => {
        mockVideo._fireEvent('play');
      });

      act(() => {
        mockVideo._fireEvent('ended');
      });

      expect(result.current.isPlaying).toBe(false);
    });

    it('should update duration on durationchange event', () => {
      const { result } = renderHook(() => useVideo(videoRef, hlsRef));

      act(() => {
        (mockVideo as any).duration = 240;
        mockVideo._fireEvent('durationchange');
      });

      expect(result.current.duration).toBe(240);
    });

    it('should not update duration when it is Infinity', () => {
      const { result } = renderHook(() => useVideo(videoRef, hlsRef));

      act(() => {
        (mockVideo as any).duration = Infinity;
        mockVideo._fireEvent('durationchange');
      });

      expect(result.current.duration).toBe(0);
    });

    it('should update currentTime on timeupdate event', () => {
      const { result } = renderHook(() => useVideo(videoRef, hlsRef));

      act(() => {
        (mockVideo as any).currentTime = 30.5;
        mockVideo._fireEvent('timeupdate');
      });

      expect(result.current.currentTime).toBe(30.5);
    });

    it('should update volume on volumechange event', () => {
      const { result } = renderHook(() => useVideo(videoRef, hlsRef));

      act(() => {
        (mockVideo as any).volume = 0.5;
        mockVideo._fireEvent('volumechange');
      });

      expect(result.current.volume).toBe(0.5);
    });

    it('should report volume as 0 when muted', () => {
      const { result } = renderHook(() => useVideo(videoRef, hlsRef));

      act(() => {
        (mockVideo as any).muted = true;
        (mockVideo as any).volume = 0.8;
        mockVideo._fireEvent('volumechange');
      });

      expect(result.current.volume).toBe(0);
    });

    it('should set isBuffering on waiting event and clear on playing/canplay/seeked', () => {
      const { result } = renderHook(() => useVideo(videoRef, hlsRef));

      act(() => {
        mockVideo._fireEvent('waiting');
      });
      expect(result.current.isBuffering).toBe(true);

      act(() => {
        mockVideo._fireEvent('playing');
      });
      expect(result.current.isBuffering).toBe(false);

      act(() => {
        mockVideo._fireEvent('waiting');
      });
      expect(result.current.isBuffering).toBe(true);

      act(() => {
        mockVideo._fireEvent('canplay');
      });
      expect(result.current.isBuffering).toBe(false);

      act(() => {
        mockVideo._fireEvent('waiting');
      });
      expect(result.current.isBuffering).toBe(true);

      act(() => {
        mockVideo._fireEvent('seeked');
      });
      expect(result.current.isBuffering).toBe(false);
    });
  });

  describe('control methods', () => {
    it('play() should call video.play()', () => {
      const { result } = renderHook(() => useVideo(videoRef, hlsRef));

      act(() => {
        result.current.play();
      });

      expect(mockVideo.play).toHaveBeenCalledTimes(1);
    });

    it('pause() should call video.pause()', () => {
      const { result } = renderHook(() => useVideo(videoRef, hlsRef));

      act(() => {
        result.current.pause();
      });

      expect(mockVideo.pause).toHaveBeenCalledTimes(1);
    });

    it('seek() should set video.currentTime', () => {
      (mockVideo as any).duration = 100;

      const { result } = renderHook(() => useVideo(videoRef, hlsRef));

      act(() => {
        result.current.seek(50);
      });

      expect(mockVideo.currentTime).toBe(50);
    });

    it('seek() should clamp to 0 for negative values', () => {
      (mockVideo as any).duration = 100;

      const { result } = renderHook(() => useVideo(videoRef, hlsRef));

      act(() => {
        result.current.seek(-10);
      });

      expect(mockVideo.currentTime).toBe(0);
    });

    it('seek() should clamp to duration for values exceeding duration', () => {
      (mockVideo as any).duration = 100;

      const { result } = renderHook(() => useVideo(videoRef, hlsRef));

      act(() => {
        result.current.seek(200);
      });

      expect(mockVideo.currentTime).toBe(100);
    });

    it('seek() should clamp to 0 when duration is 0', () => {
      (mockVideo as any).duration = 0;

      const { result } = renderHook(() => useVideo(videoRef, hlsRef));

      act(() => {
        result.current.seek(50);
      });

      expect(mockVideo.currentTime).toBe(0);
    });

    it('setVolume() should set video volume and muted state', () => {
      const { result } = renderHook(() => useVideo(videoRef, hlsRef));

      act(() => {
        result.current.setVolume(0.7);
      });

      expect(mockVideo.volume).toBe(0.7);
      expect(mockVideo.muted).toBe(false);
    });

    it('setVolume(0) should mute the video', () => {
      const { result } = renderHook(() => useVideo(videoRef, hlsRef));

      act(() => {
        result.current.setVolume(0);
      });

      expect(mockVideo.volume).toBe(0);
      expect(mockVideo.muted).toBe(true);
    });

    it('setVolume() should clamp to 0-1 range', () => {
      const { result } = renderHook(() => useVideo(videoRef, hlsRef));

      act(() => {
        result.current.setVolume(1.5);
      });
      expect(mockVideo.volume).toBe(1);

      act(() => {
        result.current.setVolume(-0.5);
      });
      expect(mockVideo.volume).toBe(0);
      expect(mockVideo.muted).toBe(true);
    });

    it('play() should not throw when videoRef is null', () => {
      videoRef.current = null;
      const { result } = renderHook(() => useVideo(videoRef, hlsRef));

      expect(() => {
        act(() => {
          result.current.play();
        });
      }).not.toThrow();
    });

    it('pause() should not throw when videoRef is null', () => {
      videoRef.current = null;
      const { result } = renderHook(() => useVideo(videoRef, hlsRef));

      expect(() => {
        act(() => {
          result.current.pause();
        });
      }).not.toThrow();
    });

    it('seek() should not throw when videoRef is null', () => {
      videoRef.current = null;
      const { result } = renderHook(() => useVideo(videoRef, hlsRef));

      expect(() => {
        act(() => {
          result.current.seek(10);
        });
      }).not.toThrow();
    });

    it('setVolume() should not throw when videoRef is null', () => {
      videoRef.current = null;
      const { result } = renderHook(() => useVideo(videoRef, hlsRef));

      expect(() => {
        act(() => {
          result.current.setVolume(0.5);
        });
      }).not.toThrow();
    });
  });

  describe('setQuality', () => {
    it('should set hls.currentLevel', () => {
      const mockHls = {
        currentLevel: -1,
        levels: [],
        on: vi.fn(),
        off: vi.fn(),
        constructor: { Events: { MANIFEST_PARSED: 'MANIFEST_PARSED', LEVEL_SWITCHED: 'LEVEL_SWITCHED' } },
      };
      hlsRef.current = mockHls;

      const { result } = renderHook(() => useVideo(videoRef, hlsRef));

      act(() => {
        result.current.setQuality(2);
      });

      expect(mockHls.currentLevel).toBe(2);
    });

    it('should accept -1 for auto quality', () => {
      const mockHls = {
        currentLevel: 0,
        levels: [],
        on: vi.fn(),
        off: vi.fn(),
        constructor: { Events: { MANIFEST_PARSED: 'MANIFEST_PARSED', LEVEL_SWITCHED: 'LEVEL_SWITCHED' } },
      };
      hlsRef.current = mockHls;

      const { result } = renderHook(() => useVideo(videoRef, hlsRef));

      act(() => {
        result.current.setQuality(-1);
      });

      expect(mockHls.currentLevel).toBe(-1);
    });

    it('should not throw when hlsRef is null', () => {
      const { result } = renderHook(() => useVideo(videoRef, hlsRef));

      expect(() => {
        act(() => {
          result.current.setQuality(0);
        });
      }).not.toThrow();
    });
  });

  describe('cleanup', () => {
    it('should remove event listeners on unmount', () => {
      const { unmount } = renderHook(() => useVideo(videoRef, hlsRef));

      unmount();

      expect(mockVideo.removeEventListener).toHaveBeenCalledWith('play', expect.any(Function));
      expect(mockVideo.removeEventListener).toHaveBeenCalledWith('pause', expect.any(Function));
      expect(mockVideo.removeEventListener).toHaveBeenCalledWith('ended', expect.any(Function));
      expect(mockVideo.removeEventListener).toHaveBeenCalledWith('durationchange', expect.any(Function));
      expect(mockVideo.removeEventListener).toHaveBeenCalledWith('timeupdate', expect.any(Function));
      expect(mockVideo.removeEventListener).toHaveBeenCalledWith('volumechange', expect.any(Function));
      expect(mockVideo.removeEventListener).toHaveBeenCalledWith('waiting', expect.any(Function));
      expect(mockVideo.removeEventListener).toHaveBeenCalledWith('playing', expect.any(Function));
      expect(mockVideo.removeEventListener).toHaveBeenCalledWith('canplay', expect.any(Function));
      expect(mockVideo.removeEventListener).toHaveBeenCalledWith('seeked', expect.any(Function));
    });
  });
});
