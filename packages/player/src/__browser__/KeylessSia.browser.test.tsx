// Keyless direct-from-Sia playback in real browsers, with the real SDK: a
// SlubyClient with no API key, its real SiaSession fetching the public share
// map for the playback url, SlubyPlayer (and plain hls.js with the
// @sluby/player/hls loader) playing through MSE. Only the Sia network is fake
// (fake-sia-storage.ts, aliased over @siafoundation/sia-storage), so every
// request that reaches the fixture server is one a real page would make.

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createRef } from 'react';
import Hls from 'hls.js';
import { PermissionError, SlubyClient } from '@sluby/sdk';
import { SlubyPlayer, type SlubyPlayerHandle } from '../SlubyPlayer.js';
import { createSiaLoader } from '../hls.js';
import { fakeSiaLog, resetFakeSia } from './fake-sia-storage.js';
import {
  GATED_SHARE_ID,
  apiRequests,
  gatewayRequests,
  getCatalog,
  mount,
  resetGateway,
  shareRequests,
  signedUrls,
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
    const deliveries: Array<'sia' | 'hybrid' | 'gateway'> = [];
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
    const deliveries: Array<'sia' | 'hybrid' | 'gateway'> = [];
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
    // play once the element can play and hls.js is done seeking, as the player
    // does: webkit can stop the clock for good when play() is pending during
    // hls.js's seek over the gap before the first buffered frame
    const el = video;
    const playWhenSettled = () => {
      if (el.seeking || el.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) return;
      el.removeEventListener('canplay', playWhenSettled);
      el.removeEventListener('seeked', playWhenSettled);
      void el.play();
    };
    el.addEventListener('canplay', playWhenSettled);
    el.addEventListener('seeked', playWhenSettled);

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

describe('gated share maps: signatures and expiry', () => {
  it('plays a signed url for gated content from Sia, with the signature on the share map', async () => {
    const client = keylessClient();
    const { stream, expires } = await signedUrls(3600);
    const ref = createRef<SlubyPlayerHandle>();
    const deliveries: Array<'sia' | 'hybrid' | 'gateway'> = [];
    mounted = mount(
      <SlubyPlayer
        ref={ref}
        src={stream}
        client={client}
        assetId={GATED_SHARE_ID}
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
    expect(await gatewayRequests()).toEqual([]);
    const shares = await shareRequests();
    expect(shares).toHaveLength(1);
    expect(shares[0]).toMatchObject({ id: GATED_SHARE_ID, expires: String(expires) });
  });

  it('refuses the map for a bad or expired signature, so the session cannot open gated content', async () => {
    const client = keylessClient();
    const { stream } = await signedUrls(3600);
    const forged = stream.replace(/sig=[0-9a-f]+/, `sig=${'0'.repeat(64)}`);

    const refused = await client.sia!.prepare(GATED_SHARE_ID, { src: forged }).catch((e) => e);
    expect(refused).toBeInstanceOf(PermissionError);

    const unsigned = stream.split('?')[0];
    await expect(client.sia!.prepare(GATED_SHARE_ID, { src: unsigned })).rejects.toBeInstanceOf(
      PermissionError,
    );

    const lapsed = await signedUrls(-10);
    const expired = await client
      .sia!.getShareMap(GATED_SHARE_ID, { src: lapsed.stream })
      .catch((e) => e);
    expect(expired).toBeInstanceOf(PermissionError);
    expect((expired as PermissionError).responseBody).toContain('expired');
  });

  it('caps the map at the signature and keeps playing past it with a src from refreshSrc', async () => {
    const client = keylessClient();
    const first = await signedUrls(3);
    const renewed: string[] = [];
    const refreshSrc = vi.fn(async () => {
      const next = await signedUrls(3600);
      renewed.push(next.stream);
      return next.stream;
    });
    const ref = createRef<SlubyPlayerHandle>();
    const deliveries: Array<'sia' | 'hybrid' | 'gateway'> = [];
    const errors: Error[] = [];
    mounted = mount(
      <SlubyPlayer
        ref={ref}
        src={first.stream}
        refreshSrc={refreshSrc}
        client={client}
        assetId={GATED_SHARE_ID}
        muted
        autoPlay
        onDeliveryChange={(d) => deliveries.push(d)}
        onError={(e) => errors.push(e)}
      />,
    );

    // the clip is about 3 s, so loop it to have playback that outlasts the signature
    await vi.waitFor(() => expect(ref.current?.getVideoElement()).toBeTruthy());
    ref.current!.getVideoElement()!.loop = true;

    // renewed before the first signature runs out
    await vi.waitFor(() => expect(refreshSrc).toHaveBeenCalledTimes(1), {
      timeout: 5_000,
      interval: 50,
    });
    expect(Date.now()).toBeLessThan(first.expires * 1000);

    // and still playing from Sia after it did
    await vi.waitFor(() => expect(Date.now()).toBeGreaterThan(first.expires * 1000 + 500), {
      timeout: 6_000,
      interval: 100,
    });
    const v = ref.current!.getVideoElement()!;
    const at = v.currentTime;
    await vi.waitFor(
      () => {
        expect(v.paused).toBe(false);
        expect(v.currentTime).not.toBe(at);
      },
      { timeout: 10_000, interval: 50 },
    );

    expect(errors).toEqual([]);
    expect(deliveries.every((d) => d === 'sia')).toBe(true);
    expect(refreshSrc).toHaveBeenCalledWith(first.stream);
    const sigs = (await shareRequests()).map((r) => r.sig);
    expect(new Set(sigs).size).toBe(2);
    expect(sigs).toContain(new URL(renewed[0]).searchParams.get('sig'));
    expect(await gatewayRequests()).toEqual([]);
  });
});
