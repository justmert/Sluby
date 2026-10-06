// Keyless direct-from-Sia playback in a real Chromium, with the real SDK: a
// SlubyClient with no API key, its real SiaSession fetching the public share
// map for the playback url, SlubyPlayer (and plain hls.js with the
// @sluby/player/hls loader) playing through MSE. Only the Sia network is fake
// (fake-sia-storage.ts, aliased over @siafoundation/sia-storage), so every
// request that reaches the fixture server is one a real page would make.

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createRef } from 'react';
import Hls from 'hls.js';
import { SlubyClient } from '@sluby/sdk';
import { SlubyPlayer, type SlubyPlayerHandle } from '../SlubyPlayer.js';
import { createSiaLoader } from '../hls.js';
import { fakeSiaLog, resetFakeSia } from './fake-sia-storage.js';
import {
  apiRequests,
  gatewayRequests,
  getCatalog,
  mount,
  resetGateway,
  shareRequests,
  type FixtureCatalog,
  type Mounted,
} from './harness.js';

const ASSET_ID = 'pb_keylesskeylesskeyle';
const SIA = { indexerUrl: 'https://sia.example', appId: 'ab'.repeat(32), appKey: 'cd'.repeat(32) };

let catalog: FixtureCatalog;
let mounted: Mounted | null = null;
let hls: Hls | null = null;
let video: HTMLVideoElement | null = null;

// every request the page makes, with whether it carried an Authorization header
let sentAuthorization: string[] = [];
const realFetch = window.fetch.bind(window);

beforeAll(async () => {
  catalog = await getCatalog();
});

beforeEach(async () => {
  await resetGateway();
  resetFakeSia();
  sentAuthorization = [];
  vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    if (headers.has('Authorization')) sentAuthorization.push(String(input));
    return realFetch(input, init);
  });
});

afterEach(() => {
  mounted?.unmount();
  mounted = null;
  hls?.destroy();
  hls = null;
  video?.remove();
  video = null;
  vi.restoreAllMocks();
});

function keylessClient(): SlubyClient {
  // no apiKey: the page holds nothing but the publishable viewer identity
  return new SlubyClient({ baseUrl: location.origin, sia: SIA });
}

async function expectKeylessSiaPlayback(src: string): Promise<void> {
  // what reached the server: the share map, nothing else
  expect(await gatewayRequests()).toEqual([]);
  expect(await apiRequests()).toEqual([]);
  expect(sentAuthorization).toEqual([]);
  const shares = await shareRequests();
  expect(shares.length).toBeGreaterThanOrEqual(1);
  const url = new URL(src);
  for (const r of shares) {
    expect(r).toEqual({
      id: ASSET_ID,
      expires: url.searchParams.get('expires'),
      sig: url.searchParams.get('sig'),
      authorization: false,
      cookie: false,
    });
  }

  // and the bytes came from the (fake) Sia network
  expect(fakeSiaLog.connects).toBe(1);
  expect(fakeSiaLog.downloads[0]).toEqual({
    objectId: catalog.masterId,
    offset: undefined,
    length: undefined,
  });
  const dataIds = new Set(catalog.renditions.map((r) => r.dataId));
  expect(fakeSiaLog.downloads.some((d) => dataIds.has(d.objectId))).toBe(true);
}

describe('keyless direct-from-Sia with the real SDK', () => {
  it('SlubyPlayer plays a public stream url from Sia with no key and no api calls', async () => {
    const client = keylessClient();
    const src = client.playback.streamUrl(ASSET_ID);
    const ref = createRef<SlubyPlayerHandle>();
    const deliveries: Array<'sia' | 'gateway'> = [];
    const errors: Error[] = [];
    mounted = mount(
      <SlubyPlayer
        ref={ref}
        src={src}
        client={client}
        assetId={ASSET_ID}
        muted
        autoPlay
        onDeliveryChange={(d) => deliveries.push(d)}
        onError={(e) => errors.push(e)}
      />,
    );

    await vi.waitFor(
      () => expect(ref.current!.getVideoElement()!.currentTime).toBeGreaterThan(0.5),
      { timeout: 15_000, interval: 50 },
    );

    expect(deliveries).toEqual(['sia']);
    expect(errors).toEqual([]);
    expect(ref.current?.getQualities().map((q) => q.name)).toEqual(['144p', '240p']);
    await expectKeylessSiaPlayback(src);
  });

  it('SlubyPlayer plays a signed objects url and passes its signature to the share map', async () => {
    const client = keylessClient();
    // a signed url your server minted with its key, handed to the page
    const src = `${location.origin}/v1/objects/${catalog.masterId}?type=manifest&expires=4102444800&sig=${'ab'.repeat(32)}`;
    const ref = createRef<SlubyPlayerHandle>();
    const deliveries: Array<'sia' | 'gateway'> = [];
    mounted = mount(
      <SlubyPlayer
        ref={ref}
        src={src}
        client={client}
        assetId={ASSET_ID}
        muted
        autoPlay
        onDeliveryChange={(d) => deliveries.push(d)}
      />,
    );

    await vi.waitFor(
      () => expect(ref.current!.getVideoElement()!.currentTime).toBeGreaterThan(0.5),
      { timeout: 15_000, interval: 50 },
    );

    expect(deliveries).toEqual(['sia']);
    await expectKeylessSiaPlayback(src);
  });

  it('plain hls.js with createSiaLoader plays a public stream url from Sia', async () => {
    const client = keylessClient();
    const src = client.playback.streamUrl(ASSET_ID);
    video = document.createElement('video');
    video.muted = true;
    document.body.appendChild(video);

    await client.sia!.prepare(ASSET_ID, { src });
    hls = new Hls({ loader: createSiaLoader(client.sia!, ASSET_ID, { src }) });
    hls.loadSource(src);
    hls.attachMedia(video);
    hls.once(Hls.Events.MANIFEST_PARSED, () => void video!.play());

    await vi.waitFor(() => expect(video!.currentTime).toBeGreaterThan(0.5), {
      timeout: 15_000,
      interval: 50,
    });

    expect(hls.levels.map((l) => l.height)).toEqual([144, 240]);
    await expectKeylessSiaPlayback(src);
    // prepare fetched the map once and the loader reused it
    expect(await shareRequests()).toHaveLength(1);
  });
});
