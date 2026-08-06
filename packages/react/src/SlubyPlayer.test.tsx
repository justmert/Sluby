import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockOn,
  mockOff,
  mockAttachMedia,
  mockLoadSource,
  mockDestroy,
  mockStartLoad,
  mockRecoverMediaError,
  mockIsSupported,
  MockHlsEvents,
  MockHlsErrorTypes,
  MockHlsDefaultConfig,
  hlsInstanceRef,
} = vi.hoisted(() => {
  const mockOn = vi.fn();
  const mockOff = vi.fn();
  const mockAttachMedia = vi.fn();
  const mockLoadSource = vi.fn();
  const mockDestroy = vi.fn();
  const mockStartLoad = vi.fn();
  const mockRecoverMediaError = vi.fn();
  const mockIsSupported = vi.fn().mockReturnValue(true);

  const MockHlsEvents = {
    MANIFEST_PARSED: 'hlsManifestParsed',
    LEVEL_SWITCHED: 'hlsLevelSwitched',
    ERROR: 'hlsError',
  };
  const MockHlsErrorTypes = {
    NETWORK_ERROR: 'networkError',
    MEDIA_ERROR: 'mediaError',
    OTHER_ERROR: 'otherError',
  };
  const MockHlsDefaultConfig = {
    loader: class DefaultLoader {},
  };

  // Keep a ref to the latest hls instance
  const hlsInstanceRef = { current: null as any };

  return {
    mockOn,
    mockOff,
    mockAttachMedia,
    mockLoadSource,
    mockDestroy,
    mockStartLoad,
    mockRecoverMediaError,
    mockIsSupported,
    MockHlsEvents,
    MockHlsErrorTypes,
    MockHlsDefaultConfig,
    hlsInstanceRef,
  };
});

vi.mock('hls.js', () => {
  class MockHls {
    on = mockOn;
    off = mockOff;
    attachMedia = mockAttachMedia;
    loadSource = mockLoadSource;
    destroy = mockDestroy;
    startLoad = mockStartLoad;
    recoverMediaError = mockRecoverMediaError;
    levels: any[] = [];
    currentLevel = -1;

    constructor(public config: any) {
      hlsInstanceRef.current = this;
    }

    static isSupported = mockIsSupported;
    static Events = MockHlsEvents;
    static ErrorTypes = MockHlsErrorTypes;
    static DefaultConfig = MockHlsDefaultConfig;
  }

  return { default: MockHls };
});

// Import component after mocks are set up
import { SlubyPlayer } from './SlubyPlayer.js';
import type { SlubyPlayerHandle } from './SlubyPlayer.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SlubyPlayer', () => {
  beforeEach(() => {
    mockOn.mockClear();
    mockOff.mockClear();
    mockAttachMedia.mockClear();
    mockLoadSource.mockClear();
    mockDestroy.mockClear();
    mockStartLoad.mockClear();
    mockRecoverMediaError.mockClear();
    mockIsSupported.mockClear().mockReturnValue(true);
    hlsInstanceRef.current = null;
  });

  afterEach(() => {
    cleanup();
  });

  describe('rendering', () => {
    it('should render a video element', () => {
      const { container } = render(<SlubyPlayer src="https://example.com/video.m3u8" />);

      const video = container.querySelector('video');
      expect(video).not.toBeNull();
    });

    it('should render with controls by default', () => {
      const { container } = render(<SlubyPlayer src="https://example.com/video.m3u8" />);

      const video = container.querySelector('video');
      expect(video?.hasAttribute('controls')).toBe(true);
    });

    it('should render without controls when controls=false', () => {
      const { container } = render(
        <SlubyPlayer src="https://example.com/video.m3u8" controls={false} />,
      );

      const video = container.querySelector('video');
      expect(video?.hasAttribute('controls')).toBe(false);
    });

    it('should set playsInline attribute', () => {
      const { container } = render(<SlubyPlayer src="https://example.com/video.m3u8" />);

      const video = container.querySelector('video');
      expect(video?.hasAttribute('playsinline')).toBe(true);
    });

    it('should pass through poster prop', () => {
      const { container } = render(
        <SlubyPlayer
          src="https://example.com/video.m3u8"
          poster="https://example.com/poster.jpg"
        />,
      );

      const video = container.querySelector('video');
      expect(video?.getAttribute('poster')).toBe('https://example.com/poster.jpg');
    });

    it('should pass through width and height props', () => {
      const { container } = render(
        <SlubyPlayer src="https://example.com/video.m3u8" width={800} height={450} />,
      );

      const video = container.querySelector('video');
      expect(video?.getAttribute('width')).toBe('800');
      expect(video?.getAttribute('height')).toBe('450');
    });

    it('should pass through className prop', () => {
      const { container } = render(
        <SlubyPlayer src="https://example.com/video.m3u8" className="my-player" />,
      );

      const video = container.querySelector('video');
      expect(video?.className).toBe('my-player');
    });

    it('should pass through style prop', () => {
      const { container } = render(
        <SlubyPlayer src="https://example.com/video.m3u8" style={{ borderRadius: '8px' }} />,
      );

      const video = container.querySelector('video');
      expect(video?.style.borderRadius).toBe('8px');
    });
  });

  describe('HLS initialization', () => {
    it('should create an hls.js instance when HLS is supported', () => {
      render(<SlubyPlayer src="https://example.com/video.m3u8" />);

      expect(hlsInstanceRef.current).not.toBeNull();
      expect(hlsInstanceRef.current.config).toEqual(
        expect.objectContaining({
          enableWorker: true,
          lowLatencyMode: false,
        }),
      );
    });

    it('should attach media and load source', () => {
      render(<SlubyPlayer src="https://example.com/video.m3u8" />);

      expect(mockAttachMedia).toHaveBeenCalled();
      expect(mockLoadSource).toHaveBeenCalledWith('https://example.com/video.m3u8');
    });

    it('should register event listeners for MANIFEST_PARSED, LEVEL_SWITCHED, and ERROR', () => {
      render(<SlubyPlayer src="https://example.com/video.m3u8" />);

      const registeredEvents = mockOn.mock.calls.map((call: unknown[]) => call[0]);
      expect(registeredEvents).toContain(MockHlsEvents.MANIFEST_PARSED);
      expect(registeredEvents).toContain(MockHlsEvents.LEVEL_SWITCHED);
      expect(registeredEvents).toContain(MockHlsEvents.ERROR);
    });

    it('should pass correct HLS config values', () => {
      render(<SlubyPlayer src="https://example.com/video.m3u8" />);

      expect(hlsInstanceRef.current.config).toEqual(
        expect.objectContaining({
          enableWorker: true,
          lowLatencyMode: false,
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          maxBufferSize: 60 * 1000 * 1000,
          maxBufferHole: 0.5,
          startLevel: -1,
        }),
      );
    });

    it('should not create hls.js instance when src is empty', () => {
      render(<SlubyPlayer src="" />);

      expect(hlsInstanceRef.current).toBeNull();
    });
  });

  describe('cleanup on unmount', () => {
    it('should destroy hls.js instance on unmount', () => {
      const { unmount } = render(<SlubyPlayer src="https://example.com/video.m3u8" />);

      unmount();

      expect(mockDestroy).toHaveBeenCalled();
    });
  });

  describe('imperative handle via ref', () => {
    it('should expose getVideoElement via ref', () => {
      const ref = React.createRef<SlubyPlayerHandle>();

      render(<SlubyPlayer ref={ref} src="https://example.com/video.m3u8" />);

      expect(ref.current).not.toBeNull();
      const videoEl = ref.current!.getVideoElement();
      expect(videoEl).toBeInstanceOf(HTMLVideoElement);
    });

    it('should expose getHlsInstance via ref', () => {
      const ref = React.createRef<SlubyPlayerHandle>();

      render(<SlubyPlayer ref={ref} src="https://example.com/video.m3u8" />);

      expect(ref.current).not.toBeNull();
      const hlsInstance = ref.current!.getHlsInstance();
      expect(hlsInstance).toBe(hlsInstanceRef.current);
    });
  });

  describe('event callbacks', () => {
    it('should call onPlay when video play event fires', () => {
      const onPlay = vi.fn();
      const { container } = render(
        <SlubyPlayer src="https://example.com/video.m3u8" onPlay={onPlay} />,
      );

      const video = container.querySelector('video')!;
      video.dispatchEvent(new Event('play'));

      expect(onPlay).toHaveBeenCalled();
    });

    it('should call onPause when video pause event fires', () => {
      const onPause = vi.fn();
      const { container } = render(
        <SlubyPlayer src="https://example.com/video.m3u8" onPause={onPause} />,
      );

      const video = container.querySelector('video')!;
      video.dispatchEvent(new Event('pause'));

      expect(onPause).toHaveBeenCalled();
    });

    it('should call onEnd when video ended event fires', () => {
      const onEnd = vi.fn();
      const { container } = render(
        <SlubyPlayer src="https://example.com/video.m3u8" onEnd={onEnd} />,
      );

      const video = container.querySelector('video')!;
      video.dispatchEvent(new Event('ended'));

      expect(onEnd).toHaveBeenCalled();
    });
  });

  describe('when HLS is not supported', () => {
    it('should call onError when both hls.js and native HLS are unsupported', () => {
      mockIsSupported.mockReturnValue(false);
      const onError = vi.fn();

      render(<SlubyPlayer src="https://example.com/video.m3u8" onError={onError} />);

      // jsdom does not support HLS natively either, so video.canPlayType returns ''
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('HLS is not supported'),
        }),
      );
    });
  });
});
