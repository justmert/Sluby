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

    it('lists renditions and pins or releases one', () => {
      const ref = React.createRef<SlubyPlayerHandle>();
      const onQualitiesChange = vi.fn();
      render(<SlubyPlayer ref={ref} src={SRC} onQualitiesChange={onQualitiesChange} />);
      const hls = hlsInstanceRef.current;
      hls.levels = [
        { width: 1280, height: 720, bitrate: 3_500_000 },
        { width: 640, height: 360, bitrate: 800_000 },
      ];
      hls.autoLevelEnabled = true;

      fireHls(MockHlsEvents.MANIFEST_PARSED);

      const levels = [
        { index: 0, width: 1280, height: 720, bitrate: 3_500_000, name: '720p' },
        { index: 1, width: 640, height: 360, bitrate: 800_000, name: '360p' },
      ];
      expect(onQualitiesChange).toHaveBeenCalledWith(levels);
      expect(ref.current!.getQualities()).toEqual(levels);
      expect(ref.current!.isAutoQuality()).toBe(true);

      ref.current!.setQuality(1);
      expect(hls.currentLevel).toBe(1);
      ref.current!.setQuality(-1);
      expect(hls.currentLevel).toBe(-1);
      // out of range falls back to adaptive rather than a bogus level
      ref.current!.setQuality(7);
      expect(hls.currentLevel).toBe(-1);
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

    it('retries a failed manifest with loadSource, since startLoad needs a parsed manifest', () => {
      vi.useFakeTimers();
      try {
        render(<SlubyPlayer src={SRC} maxNetworkRetries={3} />);
        expect(mockLoadSource).toHaveBeenCalledTimes(1);

        fireHls(MockHlsEvents.ERROR, {
          fatal: true,
          type: MockHlsErrorTypes.NETWORK_ERROR,
          details: 'manifestLoadError',
        });
        act(() => {
          vi.advanceTimersByTime(1000);
        });
        expect(mockLoadSource).toHaveBeenCalledTimes(2);
        expect(mockLoadSource).toHaveBeenLastCalledWith(SRC);
        expect(mockStartLoad).not.toHaveBeenCalled();

        // once a manifest is in, a later network failure resumes with startLoad
        fireHls(MockHlsEvents.MANIFEST_PARSED);
        fireHls(MockHlsEvents.ERROR, {
          fatal: true,
          type: MockHlsErrorTypes.NETWORK_ERROR,
          details: 'fragLoadError',
        });
        act(() => {
          vi.advanceTimersByTime(2000);
        });
        expect(mockStartLoad).toHaveBeenCalledTimes(1);
        expect(mockLoadSource).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
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

    it('Retry re-runs a failed URL resolution (not stuck on the spinner)', async () => {
      const getUrl = vi
        .fn()
        .mockRejectedValueOnce(new Error('resolve failed'))
        .mockResolvedValueOnce({ playbackUrl: 'https://cache.test/ok.m3u8', posterUrl: null });
      const client = {
        resolveDeliveryUrl: (p: string) => p,
        playback: { getUrl, getSignedUrl: vi.fn() },
      };

      const { container } = render(<SlubyPlayer client={client} assetId="abc" />);

      // First resolution rejects → error overlay with a Retry button.
      const retry = await waitFor(() => {
        const btn = container.querySelector('[data-sluby-overlay="error"] button');
        if (!btn) throw new Error('no error overlay yet');
        return btn as HTMLButtonElement;
      });

      act(() => retry.dispatchEvent(new MouseEvent('click', { bubbles: true })));

      // Retry re-resolves and this time loads the source.
      await waitFor(() =>
        expect(mockLoadSource).toHaveBeenCalledWith('https://cache.test/ok.m3u8'),
      );
      expect(getUrl).toHaveBeenCalledTimes(2);
    });
  });

  describe('direct-from-Sia (client.sia)', () => {
    const GATEWAY = 'https://cache.test/v1/objects/abc?type=manifest';
    function gatewayClient(extra: Record<string, unknown> = {}) {
      return {
        resolveDeliveryUrl: (p: string) => p,
        playback: {
          getUrl: vi.fn().mockResolvedValue({ playbackUrl: GATEWAY, posterUrl: null }),
          getSignedUrl: vi.fn(),
        },
        ...extra,
      };
    }
    function viewerSession(over: Record<string, unknown> = {}) {
      return {
        prepare: vi.fn().mockResolvedValue(undefined),
        resolveObjectId: vi.fn(),
        download: vi.fn(),
        ...over,
      };
    }

    it('injects a custom loader when a viewer session resolves', async () => {
      const sia = viewerSession();
      const client = gatewayClient({ sia });

      render(<SlubyPlayer client={client} assetId="abc" />);

      await waitFor(() => expect(mockLoadSource).toHaveBeenCalledWith(GATEWAY));
      expect(sia.prepare).toHaveBeenCalledWith('abc');
      expect(typeof hlsInstanceRef.current.config.loader).toBe('function');
    });

    it('uses the gateway (no custom loader) when the client has no viewer session', async () => {
      const client = gatewayClient();

      render(<SlubyPlayer client={client} assetId="abc" />);

      await waitFor(() => expect(mockLoadSource).toHaveBeenCalledWith(GATEWAY));
      expect(hlsInstanceRef.current.config.loader).toBeUndefined();
    });

    it('reports which delivery path the load took', async () => {
      const onDeliveryChange = vi.fn();
      render(
        <SlubyPlayer
          client={gatewayClient({ sia: viewerSession() })}
          assetId="abc"
          onDeliveryChange={onDeliveryChange}
        />,
      );
      await waitFor(() => expect(onDeliveryChange).toHaveBeenCalledWith('sia'));

      cleanup();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const fallback = vi.fn();
      render(
        <SlubyPlayer
          client={gatewayClient({
            sia: viewerSession({ prepare: vi.fn().mockRejectedValue(new Error('boom')) }),
          })}
          assetId="abc"
          onDeliveryChange={fallback}
        />,
      );
      await waitFor(() => expect(fallback).toHaveBeenCalledWith('gateway'));
      warn.mockRestore();
    });

    it('falls back to the gateway when the share map cannot be fetched', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const sia = viewerSession({ prepare: vi.fn().mockRejectedValue(new Error('boom')) });
      const client = gatewayClient({ sia });

      render(<SlubyPlayer client={client} assetId="abc" />);

      await waitFor(() => expect(mockLoadSource).toHaveBeenCalledWith(GATEWAY));
      expect(hlsInstanceRef.current.config.loader).toBeUndefined();
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });

    it('does not attempt Sia when hls.js is unsupported (Safari-native path)', async () => {
      mockIsSupported.mockReturnValue(false);
      const sia = viewerSession();
      const client = gatewayClient({ sia });

      render(<SlubyPlayer client={client} assetId="abc" />);

      await waitFor(() => expect(client.playback.getUrl).toHaveBeenCalled());
      expect(sia.prepare).not.toHaveBeenCalled();
    });

    describe('with src and assetId (keyless)', () => {
      const SRC = 'https://cache.test/v1/stream/pb_abc/master.m3u8?expires=1&sig=a';

      it('streams src from Sia using the public share map, without calling the api', async () => {
        const sia = viewerSession();
        const client = gatewayClient({ sia });
        const onDeliveryChange = vi.fn();

        render(
          <SlubyPlayer
            src={SRC}
            client={client}
            assetId="pb_abc"
            onDeliveryChange={onDeliveryChange}
          />,
        );

        await waitFor(() => expect(mockLoadSource).toHaveBeenCalledWith(SRC));
        expect(sia.prepare).toHaveBeenCalledWith('pb_abc', { src: SRC });
        expect(typeof hlsInstanceRef.current.config.loader).toBe('function');
        // no gateway load was started before the session was ready
        expect(mockLoadSource).toHaveBeenCalledTimes(1);
        expect(onDeliveryChange).toHaveBeenCalledWith('sia');
        expect(client.playback.getUrl).not.toHaveBeenCalled();
        expect(client.playback.getSignedUrl).not.toHaveBeenCalled();
      });

      it('hands the src source to the loader so objects resolve from the public map', async () => {
        const sia = viewerSession({
          resolveObjectId: vi.fn().mockRejectedValue(new Error('stop here')),
        });

        render(<SlubyPlayer src={SRC} client={gatewayClient({ sia })} assetId="pb_abc" />);

        await waitFor(() => expect(mockLoadSource).toHaveBeenCalledWith(SRC));
        const Loader = hlsInstanceRef.current.config.loader;
        const loader = new Loader({});
        loader.load(
          { url: 'https://cache.test/v1/objects/variant', responseType: 'text' },
          { loadPolicy: { maxLoadTimeMs: 0 } },
          { onSuccess: vi.fn(), onError: vi.fn(), onTimeout: vi.fn() },
        );
        await waitFor(() =>
          expect(sia.resolveObjectId).toHaveBeenCalledWith('pb_abc', 'variant', { src: SRC }),
        );
      });

      it('plays src through the gateway when there is no asset id', async () => {
        const sia = viewerSession();

        render(<SlubyPlayer src={SRC} client={gatewayClient({ sia })} />);

        await waitFor(() => expect(mockLoadSource).toHaveBeenCalledWith(SRC));
        expect(sia.prepare).not.toHaveBeenCalled();
        expect(hlsInstanceRef.current.config.loader).toBeUndefined();
      });

      it('falls back to the gateway when the public share map fails', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const sia = viewerSession({ prepare: vi.fn().mockRejectedValue(new Error('403')) });
        const onDeliveryChange = vi.fn();

        render(
          <SlubyPlayer
            src={SRC}
            client={gatewayClient({ sia })}
            assetId="pb_abc"
            onDeliveryChange={onDeliveryChange}
          />,
        );

        await waitFor(() => expect(mockLoadSource).toHaveBeenCalledWith(SRC));
        expect(hlsInstanceRef.current.config.loader).toBeUndefined();
        expect(onDeliveryChange).toHaveBeenCalledWith('gateway');
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
      });

      it('does not attempt Sia on the Safari-native path', async () => {
        mockIsSupported.mockReturnValue(false);
        const canPlay = vi
          .spyOn(HTMLMediaElement.prototype, 'canPlayType')
          .mockReturnValue('maybe');
        const sia = viewerSession();
        const onDeliveryChange = vi.fn();

        const { container } = render(
          <SlubyPlayer
            src={SRC}
            client={gatewayClient({ sia })}
            assetId="pb_abc"
            onDeliveryChange={onDeliveryChange}
          />,
        );

        await waitFor(() => expect(container.querySelector('video')!.src).toBe(SRC));
        expect(onDeliveryChange).toHaveBeenCalledWith('gateway');
        expect(sia.prepare).not.toHaveBeenCalled();
        canPlay.mockRestore();
      });
    });
  });

  describe('timer safety', () => {
    it('does not fire a scheduled reload after a later fatal error destroys hls', () => {
      vi.useFakeTimers();
      try {
        const onError = vi.fn();
        render(<SlubyPlayer src={SRC} onError={onError} maxNetworkRetries={3} />);

        // A network error schedules a backoff reload (startLoad via setTimeout).
        fireHls(MockHlsEvents.ERROR, {
          fatal: true,
          type: MockHlsErrorTypes.NETWORK_ERROR,
          details: 'net',
        });
        // Before the backoff fires, an unrecoverable error gives up + destroys.
        fireHls(MockHlsEvents.ERROR, {
          fatal: true,
          type: MockHlsErrorTypes.OTHER_ERROR,
          details: 'boom',
        });
        expect(mockDestroy).toHaveBeenCalledTimes(1);

        // Advancing past the backoff must NOT call startLoad on the destroyed
        // instance (the timer was cleared on give-up).
        act(() => {
          vi.advanceTimersByTime(5000);
        });
        expect(mockStartLoad).not.toHaveBeenCalled();
        expect(onError).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
