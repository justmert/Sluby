// Direct-from-Sia playback in a real Chromium: SlubyPlayer hands hls.js the
// real SiaLoader, and every playlist and segment comes out of a Sia session
// instead of the HTTP gateway. The Sia network is the one thing faked here: a
// session that holds the fixture's objects by id and serves byte ranges the
// way the SDK's session does (see packages/sdk/src/sia-session.ts).

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createRef } from 'react';
import Hls from 'hls.js';
import { SlubyPlayer, type SlubyPlayerHandle } from '../SlubyPlayer.js';
import type { PlaybackResolver, SiaPlaybackSession } from '../types.js';
import {
  gatewayRequests,
  getCatalog,
  mount,
  objectBytes,
  objectUrl,
  resetGateway,
  type FixtureCatalog,
  type Mounted,
} from './harness.js';

const ASSET_ID = 'asset-direct-sia';
// small reads, so the loader has to stitch every response from several chunks
const CHUNK = 4096;

interface Download {
  objectId: string;
  offset: number | undefined;
  length: number | undefined;
}

/**
 * Stands in for the Sia network behind the SDK's viewer session. It knows the
 * asset's objects (its share map), resolves ids to opaque handles, and streams
 * `length` bytes from `offset`, refusing reads past the end of an object.
 */
class FakeSiaSession implements SiaPlaybackSession {
  readonly downloads: Download[] = [];
  readonly prepared: string[] = [];
  private readonly objects = new Map<string, Uint8Array>();

  constructor(
    private readonly catalog: FixtureCatalog,
    private readonly opts: { failPrepare?: Error; missing?: Set<string> } = {},
  ) {}

  async prepare(assetId: string): Promise<void> {
    this.prepared.push(assetId);
    if (this.opts.failPrepare) throw this.opts.failPrepare;
    if (assetId !== ASSET_ID) throw new Error(`no share map for asset ${assetId}`);
    for (const id of Object.keys(this.catalog.sizes)) {
      if (this.opts.missing?.has(id)) continue;
      this.objects.set(id, await objectBytes(id));
    }
  }

  async resolveObjectId(assetId: string, objectId: string): Promise<unknown> {
    if (assetId !== ASSET_ID) throw new Error(`no share map for asset ${assetId}`);
    if (!this.objects.has(objectId)) {
      throw new Error(`SiaSession: no share URL for object ${objectId}`);
    }
    return { objectId };
  }

  download(object: unknown, options?: { offset?: number; length?: number }): ReadableStream {
    const { objectId } = object as { objectId: string };
    const bytes = this.objects.get(objectId)!;
    this.downloads.push({ objectId, offset: options?.offset, length: options?.length });
    const start = options?.offset ?? 0;
    const end = options?.length === undefined ? bytes.length : start + options.length;
    let pos = start;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (end > bytes.length) {
          controller.error(new Error(`range ${start}-${end} past object end ${bytes.length}`));
          return;
        }
        if (pos >= end) {
          controller.close();
          return;
        }
        const next = Math.min(pos + CHUNK, end);
        // a copy, as a network read would hand over fresh buffers
        controller.enqueue(bytes.slice(pos, next));
        pos = next;
      },
    });
  }
}

/** What the player needs from a SlubyClient: the backend's playback answer. */
function resolverFor(catalog: FixtureCatalog, sia: SiaPlaybackSession): PlaybackResolver {
  const playbackUrl = objectUrl(catalog.masterId);
  return {
    resolveDeliveryUrl: (p) => new URL(p, location.origin).toString(),
    playback: {
      getUrl: async () => ({ playbackUrl, posterUrl: null }),
      getSignedUrl: async (_id, options) => ({
        signedUrl: `${playbackUrl}?expires=${options?.expiresIn ?? 3600}&sig=deadbeef`,
      }),
    },
    sia,
  };
}

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

function renderSiaPlayer(
  session: FakeSiaSession,
  props: Partial<React.ComponentProps<typeof SlubyPlayer>> = {},
) {
  const ref = createRef<SlubyPlayerHandle>();
  const events = { deliveries: [] as Array<'sia' | 'gateway'>, errors: [] as Error[] };
  mounted = mount(
    <SlubyPlayer
      ref={ref}
      client={resolverFor(catalog, session)}
      assetId={ASSET_ID}
      muted
      autoPlay
      onDeliveryChange={(d) => events.deliveries.push(d)}
      onError={(e) => events.errors.push(e)}
      {...props}
    />,
  );
  const video = () => ref.current!.getVideoElement()!;
  return { ref, events, video, container: mounted.container };
}

describe('SiaLoader through SlubyPlayer with real hls.js', () => {
  it('plays entirely from the Sia session with zero gateway requests', async () => {
    const session = new FakeSiaSession(catalog);
    const { ref, events, video } = renderSiaPlayer(session);

    await vi.waitFor(() => expect(video().currentTime).toBeGreaterThan(0.5), {
      timeout: 15_000,
      interval: 50,
    });

    expect(session.prepared).toEqual([ASSET_ID]);
    expect(events.deliveries).toEqual(['sia']);
    expect(events.errors).toEqual([]);
    expect(ref.current?.getHlsInstance()).toBeInstanceOf(Hls);
    expect(ref.current?.getQualities().map((q) => q.name)).toEqual(['144p', '240p']);

    // nothing went to /v1/objects: the gateway URLs were only read for ids
    expect(await gatewayRequests()).toEqual([]);

    // the master and playlists are read whole; media comes as exact byte
    // ranges taken from EXT-X-MAP and EXT-X-BYTERANGE
    expect(session.downloads[0]).toEqual({
      objectId: catalog.masterId,
      offset: undefined,
      length: undefined,
    });
    const level = ref.current!.getHlsInstance()!.currentLevel;
    const rendition = catalog.renditions[level];
    const reads = session.downloads.filter((d) => d.objectId === rendition.dataId);
    expect(reads).toContainEqual({ objectId: rendition.dataId, ...rendition.init });
    expect(reads).toContainEqual({ objectId: rendition.dataId, ...rendition.segments[0] });
    for (const read of reads) {
      const known = [rendition.init, ...rendition.segments].some(
        (r) => r.offset === read.offset && r.length === read.length,
      );
      expect(known).toBe(true);
    }
  });

  it('resolves ids from a signed manifest URL and plays', async () => {
    const session = new FakeSiaSession(catalog);
    const { events, video } = renderSiaPlayer(session, { signed: true, expiresIn: 600 });

    await vi.waitFor(() => expect(video().currentTime).toBeGreaterThan(0.3), {
      timeout: 15_000,
      interval: 50,
    });
    expect(events.deliveries).toEqual(['sia']);
    expect(session.downloads[0].objectId).toBe(catalog.masterId);
    expect(await gatewayRequests()).toEqual([]);
  });

  it('falls back to the gateway when the Sia session cannot be prepared', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const session = new FakeSiaSession(catalog, {
        failPrepare: new Error('viewer key not registered'),
      });
      const { events, video } = renderSiaPlayer(session);

      await vi.waitFor(() => expect(video().currentTime).toBeGreaterThan(0.3), {
        timeout: 15_000,
        interval: 50,
      });
      expect(events.deliveries).toEqual(['gateway']);
      expect(session.downloads).toEqual([]);
      const log = await gatewayRequests();
      expect(log[0]).toMatchObject({ id: catalog.masterId, status: 200 });
      expect(warn).toHaveBeenCalledWith(
        'Sluby: direct-from-Sia delivery unavailable, using the gateway.',
        expect.objectContaining({ message: 'viewer key not registered' }),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('reports an object the session cannot resolve through onError', async () => {
    // the share map lacks the master, so the very first load fails in the loader
    const session = new FakeSiaSession(catalog, { missing: new Set([catalog.masterId]) });
    const { events, container } = renderSiaPlayer(session, { maxNetworkRetries: 1 });

    await vi.waitFor(() => expect(events.errors).toHaveLength(1), {
      timeout: 15_000,
      interval: 50,
    });
    expect(events.deliveries).toEqual(['sia']);
    expect(events.errors[0].message).toBe(
      'Network error, gave up after 1 retries (manifestLoadError).',
    );
    expect(container.querySelector('[data-sluby-overlay="error"]')).not.toBeNull();
    expect(session.downloads).toEqual([]);
    expect(await gatewayRequests()).toEqual([]);
  });
});
