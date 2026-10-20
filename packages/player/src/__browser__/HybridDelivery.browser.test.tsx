// Hybrid delivery in real browsers with the real SDK: playlists and urgent
// segments through the fixture gateway, the rest from the fake Sia network,
// and the gateway taking over whenever Sia is slow or down.

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createRef } from 'react';
import { SlubyClient } from '@sluby/sdk';
import { SlubyPlayer, type SlubyPlayerHandle } from '../SlubyPlayer.js';
import type { HybridDeliveryStats, HybridPolicy } from '../types.js';
import { fakeSiaFaults, fakeSiaLog, resetFakeSia } from './fake-sia-storage.js';
import {
  gatewayRequests,
  getCatalog,
  mount,
  resetGateway,
  signedUrls,
  type FixtureCatalog,
  type Mounted,
} from './harness.js';

const ASSET_ID = 'pb_hybridhybridhybridh';
const SIA = { indexerUrl: 'https://sia.example', appId: 'ab'.repeat(32), appKey: 'cd'.repeat(32) };
// the fixture is three one-second segments, so the thresholds are scaled down
// to let the later segments qualify for Sia
const SMALL_CLIP: Partial<HybridPolicy> = { minBufferSec: 0.5, safetyMarginSec: 0 };

let catalog: FixtureCatalog;
let mounted: Mounted | null = null;

beforeAll(async () => {
  catalog = await getCatalog();
});

beforeEach(async () => {
  await resetGateway();
  resetFakeSia();
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
});

function renderHybrid(props: Partial<React.ComponentProps<typeof SlubyPlayer>> = {}) {
  const client = new SlubyClient({ baseUrl: location.origin, sia: SIA });
  const ref = createRef<SlubyPlayerHandle>();
  const events = {
    deliveries: [] as Array<'sia' | 'hybrid' | 'gateway'>,
    stats: [] as HybridDeliveryStats[],
    errors: [] as Error[],
  };
  mounted = mount(
    <SlubyPlayer
      ref={ref}
      src={client.playback.streamUrl(ASSET_ID)}
      client={client}
      assetId={ASSET_ID}
      siaDelivery="hybrid"
      hybridPolicy={SMALL_CLIP}
      muted
      autoPlay
      onDeliveryChange={(d) => events.deliveries.push(d)}
      onDeliveryStats={(s) => events.stats.push(s)}
      onError={(e) => events.errors.push(e)}
      {...props}
    />,
  );
  const video = () => ref.current!.getVideoElement()!;
  return { ref, events, video };
}

async function playsToTheEnd(video: () => HTMLVideoElement): Promise<void> {
  await vi.waitFor(() => expect(video().ended || video().currentTime > 2.5).toBe(true), {
    timeout: 20_000,
    interval: 50,
  });
}

const last = (stats: HybridDeliveryStats[]) => stats[stats.length - 1];

describe('hybrid delivery', () => {
  it('starts on the gateway and takes later segments from Sia', async () => {
    const { events, video } = renderHybrid();
    await playsToTheEnd(video);

    expect(events.deliveries).toEqual(['hybrid']);
    expect(events.errors).toEqual([]);

    // the playlists came over http, never from sia
    const requests = await gatewayRequests();
    expect(requests[0].id).toBe(`stream:${ASSET_ID}`);
    const playlistIds = new Set(catalog.renditions.map((r) => r.playlistId));
    expect(requests.some((r) => playlistIds.has(r.id))).toBe(true);
    expect(fakeSiaLog.downloads.some((d) => playlistIds.has(d.objectId))).toBe(false);
    expect(fakeSiaLog.downloads.some((d) => d.objectId === catalog.masterId)).toBe(false);

    // the first media came from the gateway, while sia was warmed with a
    // one-byte read, and sia then served at least one segment
    const dataIds = new Set(catalog.renditions.map((r) => r.dataId));
    expect(requests.some((r) => dataIds.has(r.id) && r.status === 206)).toBe(true);
    expect(fakeSiaLog.downloads.some((d) => dataIds.has(d.objectId) && d.length === 1)).toBe(true);
    const totals = last(events.stats);
    expect(totals.siaSegments).toBeGreaterThan(0);
    expect(totals.siaBytes).toBeGreaterThan(0);
    expect(totals.gatewaySegments).toBeGreaterThan(0);
    expect(totals.fallbacks).toBe(0);
  });

  it('hands a stalled Sia read to the gateway and keeps playing', async () => {
    fakeSiaFaults.stallReads = true;
    const { events, video } = renderHybrid({
      hybridPolicy: { ...SMALL_CLIP, maxSiaWaitMs: 300 },
    });
    await playsToTheEnd(video);

    expect(events.errors).toEqual([]);
    const totals = last(events.stats);
    expect(totals.fallbacks).toBeGreaterThan(0);
    expect(totals.siaSegments).toBe(0);
    expect(totals.gatewaySegments).toBeGreaterThanOrEqual(3);
  });

  it('stops asking Sia after maxFailures reads in a row fail', async () => {
    fakeSiaFaults.stallReads = true;
    const { events, video } = renderHybrid({
      hybridPolicy: { ...SMALL_CLIP, maxSiaWaitMs: 300, maxFailures: 1, pauseMs: 60_000 },
    });
    await playsToTheEnd(video);

    expect(events.errors).toEqual([]);
    // one segment read was tried and cut off; Sia was then paused
    const segmentReads = fakeSiaLog.downloads.filter((d) => d.length !== 1);
    expect(segmentReads).toHaveLength(1);
    expect(last(events.stats).fallbacks).toBe(1);
  });

  it('plays everything through the gateway when Sia cannot connect', async () => {
    fakeSiaFaults.failConnect = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { events, video } = renderHybrid();
      await playsToTheEnd(video);

      expect(events.deliveries).toEqual(['hybrid']);
      expect(events.errors).toEqual([]);
      const totals = last(events.stats);
      expect(totals.siaSegments).toBe(0);
      expect(totals.siaBytes).toBe(0);
      expect(fakeSiaLog.downloads).toEqual([]);
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('moves the gateway requests onto a renewed signature without reloading', async () => {
    const first = await signedUrls(6);
    const refreshSrc = vi.fn(async () => (await signedUrls(3600)).object);
    const client = new SlubyClient({ baseUrl: location.origin, sia: SIA });
    const ref = createRef<SlubyPlayerHandle>();
    const errors: Error[] = [];
    mounted = mount(
      <SlubyPlayer
        ref={ref}
        src={first.object}
        refreshSrc={refreshSrc}
        client={client}
        assetId="pb_signedsignedsigned"
        siaDelivery="hybrid"
        muted
        onError={(e) => errors.push(e)}
      />,
    );
    await vi.waitFor(
      () =>
        expect(ref.current?.getVideoElement()?.readyState).toBeGreaterThanOrEqual(
          HTMLMediaElement.HAVE_FUTURE_DATA,
        ),
      { timeout: 15_000, interval: 50 },
    );
    const hls = ref.current!.getHlsInstance()!;
    await vi.waitFor(() => expect(Date.now()).toBeGreaterThan(first.expires * 1000 + 250), {
      timeout: 15_000,
      interval: 100,
    });
    expect(refreshSrc).toHaveBeenCalledTimes(1);

    // a quality switch after the first signature ran out loads on the new one
    const before = (await gatewayRequests()).length;
    const target = hls.currentLevel === 0 ? 1 : 0;
    ref.current!.setQuality(target);
    await vi.waitFor(
      async () => {
        const after = (await gatewayRequests()).slice(before);
        expect(after.some((r) => r.id === catalog.renditions[target].dataId)).toBe(true);
      },
      { timeout: 10_000, interval: 100 },
    );
    const after = (await gatewayRequests()).slice(before);
    expect(after.filter((r) => r.status === 403)).toEqual([]);
    expect(after.every((r) => Number(r.expires) > first.expires)).toBe(true);
    expect(ref.current!.getHlsInstance()).toBe(hls);
    expect(errors).toEqual([]);
  }, 40_000);
});
