// SlubyPlayer driving the real hls.js in real browsers: MSE, real network
// requests to the fixture gateway, real decode and playback.

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createRef, useState } from 'react';
import Hls from 'hls.js';
import { SlubyPlayer, type SlubyPlayerHandle } from '../SlubyPlayer.js';
import type { PlayerState, QualityLevel } from '../types.js';
import {
  gatewayRequests,
  getCatalog,
  injectFault,
  mount,
  objectUrl,
  rangeHeader,
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

function renderPlayer(props: Partial<React.ComponentProps<typeof SlubyPlayer>> = {}) {
  const ref = createRef<SlubyPlayerHandle>();
  const events = {
    states: [] as PlayerState[],
    qualities: [] as QualityLevel[][],
    qualityChanges: [] as QualityLevel[],
    deliveries: [] as Array<'sia' | 'gateway'>,
    errors: [] as Error[],
    ready: 0,
  };
  mounted = mount(
    <SlubyPlayer
      ref={ref}
      src={objectUrl(catalog.masterId)}
      muted
      autoPlay
      onStateChange={(s) => events.states.push(s)}
      onQualitiesChange={(q) => events.qualities.push(q)}
      onQualityChange={(q) => events.qualityChanges.push(q)}
      onDeliveryChange={(d) => events.deliveries.push(d)}
      onError={(e) => events.errors.push(e)}
      onReady={() => events.ready++}
      {...props}
    />,
  );
  const video = () => {
    const el = ref.current?.getVideoElement();
    if (!el) throw new Error('player has no video element');
    return el;
  };
  return { ref, events, video, container: mounted.container };
}

describe('SlubyPlayer with real hls.js', () => {
  it('attaches hls.js to the video, loads the master, picks a level, and plays', async () => {
    const { ref, events, video } = renderPlayer();

    await vi.waitFor(() => expect(video().currentTime).toBeGreaterThan(0.5), {
      timeout: 15_000,
      interval: 50,
    });

    const hls = ref.current?.getHlsInstance();
    expect(hls).toBeInstanceOf(Hls);
    expect(hls?.media).toBe(video());
    // hls.js feeds the element through MediaSource, not a direct src
    expect(video().src.startsWith('blob:')).toBe(true);
    expect(video().paused).toBe(false);

    expect(events.deliveries).toEqual(['gateway']);
    expect(events.ready).toBe(1);
    expect(events.states).toContain('loading');
    expect(events.states).toContain('ready');
    expect(events.errors).toEqual([]);

    expect(events.qualities).toHaveLength(1);
    expect(
      events.qualities[0].map(({ index, width, height, name }) => ({ index, width, height, name })),
    ).toEqual([
      { index: 0, width: 256, height: 144, name: '144p' },
      { index: 1, width: 426, height: 240, name: '240p' },
    ]);
    expect(events.qualities[0][0].bitrate).toBeGreaterThan(0);
    expect(ref.current?.getQualities()).toEqual(events.qualities[0]);
    expect(ref.current?.isAutoQuality()).toBe(true);

    // a level was picked and reported
    expect(events.qualityChanges.length).toBeGreaterThan(0);
    const picked = events.qualityChanges[events.qualityChanges.length - 1];
    expect(hls?.currentLevel).toBe(picked.index);

    // what went over the wire: the master and a playlist as whole objects, then
    // the picked rendition's init segment and media segments as byte ranges
    const log = await gatewayRequests();
    expect(log[0]).toMatchObject({ id: catalog.masterId, range: null, status: 200 });
    const rendition = catalog.renditions[picked.index];
    expect(log.some((r) => r.id === rendition.playlistId && r.status === 200)).toBe(true);
    const dataRanges = log.filter((r) => r.id === rendition.dataId).map((r) => r.range);
    expect(dataRanges).toContain(rangeHeader(rendition.init));
    expect(dataRanges).toContain(rangeHeader(rendition.segments[0]));
    expect(log.filter((r) => r.id === rendition.dataId).every((r) => r.status === 206)).toBe(true);
  });

  it('switches levels on manual quality selection and back to auto', async () => {
    const { ref, events, video } = renderPlayer();
    await vi.waitFor(() => expect(video().currentTime).toBeGreaterThan(0.2), {
      timeout: 15_000,
      interval: 50,
    });

    const hls = ref.current!.getHlsInstance()!;
    const target = hls.currentLevel === 0 ? 1 : 0;
    const before = await gatewayRequests();

    ref.current!.setQuality(target);
    expect(ref.current!.isAutoQuality()).toBe(false);

    await vi.waitFor(
      () => {
        expect(events.qualityChanges[events.qualityChanges.length - 1]?.index).toBe(target);
        expect(hls.currentLevel).toBe(target);
      },
      { timeout: 10_000, interval: 50 },
    );

    // the switch fetched the target rendition's own bytes
    const rendition = catalog.renditions[target];
    await vi.waitFor(
      async () => {
        const after = (await gatewayRequests()).slice(before.length);
        expect(after.some((r) => r.id === rendition.dataId && r.status === 206)).toBe(true);
      },
      { timeout: 10_000, interval: 100 },
    );
    expect(events.qualityChanges[events.qualityChanges.length - 1]).toMatchObject({
      index: target,
      height: target === 0 ? 144 : 240,
    });

    // an out-of-range index hands the choice back to the abr controller
    ref.current!.setQuality(99);
    expect(ref.current!.isAutoQuality()).toBe(true);
    ref.current!.setQuality(target);
    expect(ref.current!.isAutoQuality()).toBe(false);
    ref.current!.setQuality(-1);
    expect(ref.current!.isAutoQuality()).toBe(true);
    expect(events.errors).toEqual([]);
  });

  it('surfaces a fragment 404 through onError and the overlay, and Retry recovers', async () => {
    // init segments load, every media segment of every rendition 404s
    for (const r of catalog.renditions) {
      await injectFault(r.dataId, 404, r.segments[0].offset);
    }

    // hls.js keeps re-requesting a failed fragment with its default backoff
    // (about 30s in total) before it calls the error fatal, so this waits
    // that long; the player has no say in that schedule
    const { ref, events, video, container } = renderPlayer({ maxNetworkRetries: 0 });
    await vi.waitFor(() => expect(events.errors).toHaveLength(1), {
      timeout: 45_000,
      interval: 100,
    });
    expect(events.errors[0].message).toBe(
      'Network error, gave up after 0 retries (fragLoadError).',
    );
    expect(events.states[events.states.length - 1]).toBe('error');
    // giving up tears hls.js down
    expect(ref.current?.getHlsInstance()).toBeNull();
    // onError runs from the hls.js event; react renders the overlay after it
    await vi.waitFor(() =>
      expect(container.querySelector('[data-sluby-overlay="error"]')?.textContent).toContain(
        events.errors[0].message,
      ),
    );
    const overlay = container.querySelector('[data-sluby-overlay="error"]');

    const log = await gatewayRequests();
    const failed = log.filter((r) => r.status === 404);
    expect(failed.length).toBeGreaterThan(1);
    // only media segments failed: every init range was served
    const initRanges = new Set(catalog.renditions.map((r) => rangeHeader(r.init)));
    expect(failed.every((r) => !initRanges.has(r.range ?? ''))).toBe(true);

    await resetGateway();
    const retry = overlay?.querySelector('button');
    expect(retry?.textContent).toBe('Retry');
    retry!.click();

    await vi.waitFor(() => expect(video().currentTime).toBeGreaterThan(0.3), {
      timeout: 15_000,
      interval: 50,
    });
    expect(container.querySelector('[data-sluby-overlay="error"]')).toBeNull();
    expect(ref.current?.getHlsInstance()).toBeInstanceOf(Hls);
    expect(events.errors).toHaveLength(1);
  }, 90_000);

  it('keeps playing after every reload that resumes near the start', async () => {
    // a new url for the same video (a renewed signature) reloads hls.js at the
    // position reached. webkit can stop the clock for good when play() is
    // pending during the seek to a position near the start; before
    // the player waited for that seek, about half of the runs of 16 reloads did
    const ref = createRef<SlubyPlayerHandle>();
    let setSrc: (src: string) => void = () => {};
    function Swapper() {
      const [src, set] = useState(objectUrl(catalog.masterId));
      setSrc = set;
      return <SlubyPlayer ref={ref} src={src} muted autoPlay controls={false} />;
    }
    mounted = mount(<Swapper />);
    await vi.waitFor(() => expect(ref.current?.getVideoElement()).toBeTruthy());
    const video = ref.current!.getVideoElement()!;

    for (let i = 1; i <= 16; i++) {
      await vi.waitFor(
        () => {
          expect(video.paused).toBe(false);
          expect(video.readyState).toBeGreaterThanOrEqual(HTMLMediaElement.HAVE_FUTURE_DATA);
        },
        { timeout: 15_000, interval: 20 },
      );
      video.currentTime = 0.3;
      await vi.waitFor(() => expect(video.seeking).toBe(false), { timeout: 5_000, interval: 20 });

      const previous = ref.current!.getHlsInstance();
      setSrc(`${objectUrl(catalog.masterId)}?reload=${i}`);
      await vi.waitFor(() => {
        const hls = ref.current!.getHlsInstance();
        expect(hls).toBeInstanceOf(Hls);
        expect(hls).not.toBe(previous);
      });
      // near 0.3, plus however far it played before the new url took over
      const resumeAt = ref.current!.getHlsInstance()!.config.startPosition;
      expect(resumeAt).toBeGreaterThan(0.2);

      // the reload lands on the position, then plays on from it
      await vi.waitFor(
        () => {
          expect(video.seeking).toBe(false);
          expect(video.readyState).toBeGreaterThanOrEqual(HTMLMediaElement.HAVE_FUTURE_DATA);
          expect(Math.abs(video.currentTime - resumeAt)).toBeLessThan(0.05);
        },
        { timeout: 15_000, interval: 20 },
      );
      const landed = video.currentTime;
      await vi.waitFor(
        () => {
          expect(video.paused).toBe(false);
          expect(video.currentTime).not.toBe(landed);
        },
        { timeout: 5_000, interval: 20 },
      );
    }
  }, 120_000);

  it('re-requests a master that 404s on each retry, then reports the error', async () => {
    await injectFault(catalog.masterId, 404);
    const { events, container } = renderPlayer({ maxNetworkRetries: 2 });

    await vi.waitFor(() => expect(events.errors).toHaveLength(1), {
      timeout: 15_000,
      interval: 50,
    });
    expect(events.errors[0].message).toBe(
      'Network error, gave up after 2 retries (manifestLoadError).',
    );
    // the first load plus one per retry, all for the master
    const log = await gatewayRequests();
    expect(log).toHaveLength(3);
    expect(log.every((r) => r.id === catalog.masterId && r.status === 404)).toBe(true);
    expect(events.states[events.states.length - 1]).toBe('error');
    await vi.waitFor(() =>
      expect(container.querySelector('[data-sluby-overlay="error"]')).not.toBeNull(),
    );
  });
});
