import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, cleanup, act, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Hoisted hls.js mock
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
  hlsInstanceRef,
} = vi.hoisted(() => {
  return {
    mockOn: vi.fn(),
    mockOff: vi.fn(),
    mockAttachMedia: vi.fn(),
    mockLoadSource: vi.fn(),
    mockDestroy: vi.fn(),
    mockStartLoad: vi.fn(),
    mockRecoverMediaError: vi.fn(),
    mockIsSupported: vi.fn().mockReturnValue(true),
    MockHlsEvents: {
      MANIFEST_PARSED: 'hlsManifestParsed',
      LEVEL_SWITCHED: 'hlsLevelSwitched',
      FRAG_BUFFERED: 'hlsFragBuffered',
      ERROR: 'hlsError',
    },
    MockHlsErrorTypes: {
      NETWORK_ERROR: 'networkError',
      MEDIA_ERROR: 'mediaError',
      OTHER_ERROR: 'otherError',
    },
    hlsInstanceRef: { current: null as any },
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
  }
  return { default: MockHls };
});

import { SlubyPlayer } from './SlubyPlayer.js';
import type { SlubyPlayerHandle } from './SlubyPlayer.js';

const SRC = 'https://example.com/video.m3u8';

/** Invoke the handler registered on the mock hls instance for an event. */
function fireHls(event: string, data?: unknown) {
  const call = [...mockOn.mock.calls].reverse().find((c: unknown[]) => c[0] === event);
  if (!call) throw new Error(`no hls handler registered for ${event}`);
  act(() => {
    (call[1] as (e: string, d?: unknown) => void)(event, data);
  });
}

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

  afterEach(() => cleanup());

  describe('rendering', () => {
    it('renders a video element with controls and playsInline by default', () => {
      const { container } = render(<SlubyPlayer src={SRC} />);
      const video = container.querySelector('video');
      expect(video).not.toBeNull();
      expect(video?.hasAttribute('controls')).toBe(true);
      expect(video?.hasAttribute('playsinline')).toBe(true);
    });

    it('omits controls when controls=false', () => {
      const { container } = render(<SlubyPlayer src={SRC} controls={false} />);
      expect(container.querySelector('video')?.hasAttribute('controls')).toBe(false);
    });

    it('passes poster and dimensions to the video', () => {
      const { container } = render(
        <SlubyPlayer src={SRC} poster="https://example.com/p.jpg" width={800} height={450} />,
      );
      const video = container.querySelector('video');
      expect(video?.getAttribute('poster')).toBe('https://example.com/p.jpg');
      expect(video?.getAttribute('width')).toBe('800');
      expect(video?.getAttribute('height')).toBe('450');
    });

    it('applies className and style to the wrapper', () => {
      const { container } = render(
        <SlubyPlayer src={SRC} className="my-player" style={{ borderRadius: '8px' }} />,
      );
      const wrapper = container.firstElementChild as HTMLElement;
      expect(wrapper.className).toBe('my-player');
      expect(wrapper.style.borderRadius).toBe('8px');
    });
  });

  describe('HLS initialization', () => {
    it('creates an hls.js instance with the expected adaptive config', () => {
      render(<SlubyPlayer src={SRC} />);
      expect(hlsInstanceRef.current).not.toBeNull();
      expect(hlsInstanceRef.current.config).toEqual(
        expect.objectContaining({
          enableWorker: true,
          lowLatencyMode: false,
          maxBufferLength: 30,
          startLevel: -1,
        }),
      );
    });

    it('attaches media, loads the source, and registers events', () => {
      render(<SlubyPlayer src={SRC} />);
      expect(mockAttachMedia).toHaveBeenCalled();
      expect(mockLoadSource).toHaveBeenCalledWith(SRC);
      const events = mockOn.mock.calls.map((c: unknown[]) => c[0]);
      expect(events).toContain(MockHlsEvents.MANIFEST_PARSED);
      expect(events).toContain(MockHlsEvents.LEVEL_SWITCHED);
      expect(events).toContain(MockHlsEvents.FRAG_BUFFERED);
      expect(events).toContain(MockHlsEvents.ERROR);
    });

    it('does not create an instance when there is no src', () => {
      render(<SlubyPlayer src="" />);
      expect(hlsInstanceRef.current).toBeNull();
    });

    it('destroys the instance on unmount', () => {
      const { unmount } = render(<SlubyPlayer src={SRC} />);
      unmount();
      expect(mockDestroy).toHaveBeenCalled();
    });
  });

  describe('imperative handle', () => {
    it('exposes the video element and hls instance', () => {
      const ref = React.createRef<SlubyPlayerHandle>();
      render(<SlubyPlayer ref={ref} src={SRC} />);
      expect(ref.current!.getVideoElement()).toBeInstanceOf(HTMLVideoElement);
      expect(ref.current!.getHlsInstance()).toBe(hlsInstanceRef.current);
    });
  });

  describe('state & callbacks', () => {
    it('signals ready and fires onReady on MANIFEST_PARSED', () => {
      const onReady = vi.fn();
      const onStateChange = vi.fn();
      render(<SlubyPlayer src={SRC} onReady={onReady} onStateChange={onStateChange} />);

      fireHls(MockHlsEvents.MANIFEST_PARSED);

      expect(onReady).toHaveBeenCalledTimes(1);
      const states = onStateChange.mock.calls.map((c: unknown[]) => c[0]);
      expect(states).toContain('loading');
      expect(states).toContain('ready');
    });

    it('forwards play / pause / ended events', () => {
      const onPlay = vi.fn();
      const onPause = vi.fn();
      const onEnd = vi.fn();
      const { container } = render(
        <SlubyPlayer src={SRC} onPlay={onPlay} onPause={onPause} onEnd={onEnd} />,
      );
      const video = container.querySelector('video')!;
      act(() => video.dispatchEvent(new Event('play')));
      act(() => video.dispatchEvent(new Event('pause')));
      act(() => video.dispatchEvent(new Event('ended')));
      expect(onPlay).toHaveBeenCalled();
      expect(onPause).toHaveBeenCalled();
      expect(onEnd).toHaveBeenCalled();
    });

    it('reports an error when neither hls.js nor native HLS is available', () => {
      mockIsSupported.mockReturnValue(false);
      const onError = vi.fn();
      render(<SlubyPlayer src={SRC} onError={onError} />);
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('HLS is not supported') }),
      );
    });
  });

  describe('bounded error recovery', () => {
    it('retries fatal network errors up to the cap, then gives up', () => {
      const onError = vi.fn();
      render(<SlubyPlayer src={SRC} onError={onError} maxNetworkRetries={1} />);

      // First fatal network error: recover (schedule a reload), not fatal to us.
      fireHls(MockHlsEvents.ERROR, {
        fatal: true,
        type: MockHlsErrorTypes.NETWORK_ERROR,
        details: 'x',
      });
      expect(onError).not.toHaveBeenCalled();
      expect(mockDestroy).not.toHaveBeenCalled();

      // Second one exceeds the cap of 1: give up.
      fireHls(MockHlsEvents.ERROR, {
        fatal: true,
        type: MockHlsErrorTypes.NETWORK_ERROR,
        details: 'x',
      });
      expect(mockDestroy).toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('Network error, gave up') }),
      );
    });

    it('recovers fatal media errors up to the cap, then gives up', () => {
      const onError = vi.fn();
      render(<SlubyPlayer src={SRC} onError={onError} maxMediaRetries={1} />);

      fireHls(MockHlsEvents.ERROR, {
        fatal: true,
        type: MockHlsErrorTypes.MEDIA_ERROR,
        details: 'y',
      });
      expect(mockRecoverMediaError).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();

      fireHls(MockHlsEvents.ERROR, {
        fatal: true,
        type: MockHlsErrorTypes.MEDIA_ERROR,
        details: 'y',
      });
      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('Media error, gave up') }),
      );
    });

    it('ignores non-fatal errors', () => {
      const onError = vi.fn();
      render(<SlubyPlayer src={SRC} onError={onError} />);
      fireHls(MockHlsEvents.ERROR, { fatal: false, type: MockHlsErrorTypes.NETWORK_ERROR });
      expect(onError).not.toHaveBeenCalled();
      expect(mockDestroy).not.toHaveBeenCalled();
    });

    it('forgives earlier errors after a fragment buffers', () => {
      const onError = vi.fn();
      render(<SlubyPlayer src={SRC} onError={onError} maxNetworkRetries={1} />);

      fireHls(MockHlsEvents.ERROR, {
        fatal: true,
        type: MockHlsErrorTypes.NETWORK_ERROR,
        details: 'a',
      });
      fireHls(MockHlsEvents.FRAG_BUFFERED); // resets the counter
      fireHls(MockHlsEvents.ERROR, {
        fatal: true,
        type: MockHlsErrorTypes.NETWORK_ERROR,
        details: 'a',
      });

      // Because the counter reset, the second error is still within budget.
      expect(onError).not.toHaveBeenCalled();
      expect(mockDestroy).not.toHaveBeenCalled();
    });
  });

  describe('overlay', () => {
    it('shows an error overlay and re-loads on retry', () => {
      const { container } = render(<SlubyPlayer src={SRC} />);
      expect(mockLoadSource).toHaveBeenCalledTimes(1);

      fireHls(MockHlsEvents.ERROR, {
        fatal: true,
        type: MockHlsErrorTypes.OTHER_ERROR,
        details: 'boom',
      });

      const overlay = container.querySelector('[data-sluby-overlay="error"]');
      expect(overlay).not.toBeNull();
      const retry = overlay!.querySelector('button')!;
      act(() => retry.dispatchEvent(new MouseEvent('click', { bubbles: true })));

      // Retry re-initialises hls and loads the source again.
      expect(mockLoadSource).toHaveBeenCalledTimes(2);
    });
  });

  describe('SDK integration', () => {
    it('resolves the delivery URL from a client + assetId', async () => {
      const client = {
        resolveDeliveryUrl: (p: string) => p,
        playback: {
          getUrl: vi.fn().mockResolvedValue({
            playbackUrl: 'https://cache.test/v1/objects/abc?type=manifest',
            posterUrl: null,
          }),
          getSignedUrl: vi.fn(),
        },
      };

      render(<SlubyPlayer client={client} assetId="abc" />);

      await waitFor(() =>
        expect(mockLoadSource).toHaveBeenCalledWith(
          'https://cache.test/v1/objects/abc?type=manifest',
        ),
      );
      expect(client.playback.getUrl).toHaveBeenCalledWith('abc');
    });

    it('resolves a signed URL when signed is set', async () => {
      const client = {
        resolveDeliveryUrl: (p: string) => p,
        playback: {
          getUrl: vi.fn(),
          getSignedUrl: vi.fn().mockResolvedValue({ signedUrl: 'https://cache.test/signed?sig=1' }),
        },
      };

      render(<SlubyPlayer client={client} assetId="abc" signed expiresIn={120} />);

      await waitFor(() =>
        expect(mockLoadSource).toHaveBeenCalledWith('https://cache.test/signed?sig=1'),
      );
      expect(client.playback.getSignedUrl).toHaveBeenCalledWith('abc', { expiresIn: 120 });
    });
  });
});
