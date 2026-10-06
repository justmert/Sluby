import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FetchFn } from './uploads.js';

// Shared mock surface for the (lazily imported) sia-storage WASM SDK.
const h = vi.hoisted(() => {
  const initSia = vi.fn().mockResolvedValue(undefined);
  const sharedObject = vi.fn();
  const download = vi.fn();
  const fakeSdk = { objectFromShareUrl: sharedObject, download };
  const state: { connectedResult: unknown } = { connectedResult: fakeSdk };
  const connected = vi.fn(async () => state.connectedResult);
  const builderCtor = vi.fn();
  const appKeyCtor = vi.fn();
  return { initSia, sharedObject, download, fakeSdk, state, connected, builderCtor, appKeyCtor };
});

vi.mock('@siafoundation/sia-storage', () => {
  class AppKey {
    constructor(seed: Uint8Array) {
      h.appKeyCtor(seed);
    }
  }
  class Builder {
    connected = h.connected;
    constructor(url: string, meta: unknown) {
      h.builderCtor(url, meta);
    }
  }
  return { initSia: h.initSia, AppKey, Builder };
});

import { SiaSession, publicShareMapUrl } from './sia-session.js';
import { AuthenticationError } from './errors.js';

const APP_ID = 'ab'.repeat(32); // 64 hex chars (32 bytes)
const APP_KEY = 'aabbccdd'.repeat(8); // 64 hex chars -> 32 bytes
const EXPECTED_KEY = new Uint8Array(32);
for (let i = 0; i < 32; i += 4) EXPECTED_KEY.set([0xaa, 0xbb, 0xcc, 0xdd], i);
const config = { indexerUrl: 'https://sia.storage', appId: APP_ID, appKey: APP_KEY };

function makeSession(fetchImpl?: FetchFn) {
  const fetchFn = (fetchImpl ?? vi.fn()) as ReturnType<typeof vi.fn<FetchFn>>;
  return { session: new SiaSession(fetchFn, config), fetchFn };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.state.connectedResult = h.fakeSdk;
  h.sharedObject.mockImplementation(async (url: string) => ({ id: () => `obj:${url}` }));
  h.download.mockReturnValue('fake-stream');
});

describe('SiaSession.getShareMap', () => {
  it('fetches the share endpoint and maps snake_case to camelCase', async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue({
      json: async () => ({
        master_object_id: 'master-1',
        shares: { 'master-1': 'sia://a#k', 'data-1': 'sia://b#k' },
        expires_at: '2026-01-01T00:00:00Z',
      }),
    } as unknown as Response);

    const { session } = makeSession(fetchFn);
    const map = await session.getShareMap('asset-1');

    expect(fetchFn).toHaveBeenCalledWith('/api/v1/playback/asset-1/share');
    expect(map).toEqual({
      masterObjectId: 'master-1',
      shares: { 'master-1': 'sia://a#k', 'data-1': 'sia://b#k' },
      expiresAt: '2026-01-01T00:00:00Z',
    });
  });

  it('does not touch the WASM SDK to fetch a share map', async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue({
      json: async () => ({ master_object_id: 'm', shares: {}, expires_at: 'x' }),
    } as unknown as Response);

    await makeSession(fetchFn).session.getShareMap('asset-1');

    expect(h.initSia).not.toHaveBeenCalled();
    expect(h.builderCtor).not.toHaveBeenCalled();
  });
});

describe('SiaSession.connect', () => {
  it('inits WASM and connects with the viewer app id + decoded key', async () => {
    const { session } = makeSession();
    const sdk = await session.connect();

    expect(h.initSia).toHaveBeenCalledTimes(1);
    expect(h.builderCtor).toHaveBeenCalledWith('https://sia.storage', {
      appId: APP_ID,
      name: 'Sluby Player',
      description: 'Sluby direct-from-Sia video player',
      serviceUrl: 'https://sia.storage',
      logoUrl: undefined,
      callbackUrl: undefined,
    });
    expect(h.appKeyCtor).toHaveBeenCalledWith(EXPECTED_KEY);
    expect(sdk).toBe(h.fakeSdk);
  });

  it('rejects a non-32-byte app key', async () => {
    const session = new SiaSession(vi.fn() as unknown as FetchFn, {
      ...config,
      appKey: 'aabbccdd',
    });
    await expect(session.connect()).rejects.toThrow(/32-byte/);
  });

  it('rejects a non-hex app id', async () => {
    const session = new SiaSession(vi.fn() as unknown as FetchFn, { ...config, appId: 'not-hex' });
    await expect(session.connect()).rejects.toThrow(/app id/);
  });

  it('memoizes: a second connect does not re-init', async () => {
    const { session } = makeSession();
    await session.connect();
    await session.connect();
    expect(h.initSia).toHaveBeenCalledTimes(1);
  });

  it('throws when the app key is not registered (connected returns null)', async () => {
    h.state.connectedResult = null;
    const { session } = makeSession();
    await expect(session.connect()).rejects.toThrow(/not registered/);
  });

  it('does not cache a failed connect (a later call retries)', async () => {
    h.state.connectedResult = null;
    const { session } = makeSession();
    await expect(session.connect()).rejects.toThrow();
    h.state.connectedResult = h.fakeSdk;
    await expect(session.connect()).resolves.toBe(h.fakeSdk);
    expect(h.initSia).toHaveBeenCalledTimes(2);
  });
});

function shareResponse(body: {
  master_object_id: string;
  shares: Record<string, string>;
  expires_at: string;
}): Response {
  return { json: async () => body } as unknown as Response;
}
const inAnHour = () => new Date(Date.now() + 3600_000).toISOString();

describe('SiaSession.prepare', () => {
  it('connects and fetches the asset share map', async () => {
    const fetchFn = vi
      .fn<FetchFn>()
      .mockResolvedValue(
        shareResponse({ master_object_id: 'm', shares: {}, expires_at: inAnHour() }),
      );
    const session = new SiaSession(fetchFn, config);

    await session.prepare('asset-1');

    expect(h.initSia).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledWith('/api/v1/playback/asset-1/share');
  });
});

describe('SiaSession.resolveObjectId', () => {
  it('resolves an object via its share URL and caches per (asset, object)', async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue(
      shareResponse({
        master_object_id: 'm',
        shares: { d: 'sia://d#k' },
        expires_at: inAnHour(),
      }),
    );
    const session = new SiaSession(fetchFn, config);

    const o1 = await session.resolveObjectId('asset-1', 'd');
    const o2 = await session.resolveObjectId('asset-1', 'd');

    expect(o1).toBe(o2);
    expect(h.sharedObject).toHaveBeenCalledTimes(1);
    expect(h.sharedObject).toHaveBeenCalledWith('sia://d#k');
    expect(fetchFn).toHaveBeenCalledTimes(1); // map cached, not refetched
  });

  it('refetches the share map when the object is absent, then resolves', async () => {
    const fetchFn = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(
        shareResponse({
          master_object_id: 'm',
          shares: { m: 'sia://m#k' },
          expires_at: inAnHour(),
        }),
      )
      .mockResolvedValueOnce(
        shareResponse({
          master_object_id: 'm',
          shares: { m: 'sia://m#k', late: 'sia://late#k' },
          expires_at: inAnHour(),
        }),
      );
    const session = new SiaSession(fetchFn, config);

    await session.prepare('asset-1'); // caches the first map (no 'late')
    await session.resolveObjectId('asset-1', 'late');

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(h.sharedObject).toHaveBeenCalledWith('sia://late#k');
  });

  it('refetches an expired share map before resolving', async () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const fetchFn = vi
      .fn<FetchFn>()
      .mockResolvedValueOnce(
        shareResponse({ master_object_id: 'm', shares: { d: 'sia://old#k' }, expires_at: past }),
      )
      .mockResolvedValueOnce(
        shareResponse({
          master_object_id: 'm',
          shares: { d: 'sia://new#k' },
          expires_at: inAnHour(),
        }),
      );
    const session = new SiaSession(fetchFn, config);

    await session.prepare('asset-1'); // caches the already-expired map
    await session.resolveObjectId('asset-1', 'd'); // sees expiry -> refetch -> new URL

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(h.sharedObject).toHaveBeenCalledWith('sia://new#k');
  });
});

describe('SiaSession.download', () => {
  it('throws if called before connect', () => {
    const { session } = makeSession();
    expect(() => session.download({} as never, { offset: 0, length: 1 })).toThrow(/before connect/);
  });

  it('passes numeric offset/length to the SDK after resolveObjectId', async () => {
    const fetchFn = vi.fn<FetchFn>().mockResolvedValue(
      shareResponse({
        master_object_id: 'm',
        shares: { d: 'sia://d#k' },
        expires_at: inAnHour(),
      }),
    );
    const session = new SiaSession(fetchFn, config);
    const obj = await session.resolveObjectId('asset-1', 'd');

    const stream = session.download(obj, { offset: 10, length: 20 });

    expect(h.download).toHaveBeenCalledWith(obj, { offset: 10, length: 20 });
    expect(stream).toBe('fake-stream');
  });
});

describe('publicShareMapUrl', () => {
  it('maps a public stream url to /v1/share on the same base', () => {
    expect(publicShareMapUrl('asset-1', 'https://cdn.example/v1/stream/asset-1/master.m3u8')).toBe(
      'https://cdn.example/v1/share/asset-1',
    );
  });

  it('carries only expires and sig from a signed objects url', () => {
    expect(
      publicShareMapUrl(
        'asset-1',
        'https://cdn.example/v1/objects/abc?type=manifest&expires=1900000000&sig=deadbeef',
      ),
    ).toBe('https://cdn.example/v1/share/asset-1?expires=1900000000&sig=deadbeef');
  });

  it('keeps a path prefix in front of /v1 and encodes the id', () => {
    expect(
      publicShareMapUrl('pb_x/y', 'https://example.com/sluby/v1/stream/pb_x/master.m3u8'),
    ).toBe('https://example.com/sluby/v1/share/pb_x%2Fy');
  });

  it('throws for a url that is not a gateway playback url', () => {
    expect(() => publicShareMapUrl('asset-1', 'https://cdn.example/video.m3u8')).toThrow(
      /not a Sluby gateway playback URL/,
    );
  });
});

describe('SiaSession with a playback url source', () => {
  const SRC = 'https://cdn.example/v1/stream/pb_abc/master.m3u8?expires=1900000000&sig=feed';
  const SHARE = 'https://cdn.example/v1/share/asset-1?expires=1900000000&sig=feed';

  function publicSession() {
    const fetchFn = vi.fn<FetchFn>();
    const fetchPublic = vi.fn(async (_url: string) =>
      shareResponse({
        master_object_id: 'm',
        shares: { m: 'sia://pub-m#k', d: 'sia://pub-d#k' },
        expires_at: inAnHour(),
      }),
    );
    const session = new SiaSession(fetchFn, config, {
      fetchPublic,
      resolveDeliveryUrl: (p) => (p.startsWith('/') ? `https://cdn.example${p}` : p),
    });
    return { session, fetchFn, fetchPublic };
  }

  it('fetches the public share endpoint, never the api', async () => {
    const { session, fetchFn, fetchPublic } = publicSession();

    const map = await session.getShareMap('asset-1', { src: SRC });

    expect(fetchPublic).toHaveBeenCalledWith(SHARE);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(map.shares.d).toBe('sia://pub-d#k');
  });

  it('resolves a relative src against the delivery base', async () => {
    const { session, fetchPublic } = publicSession();

    await session.getShareMap('asset-1', { src: '/v1/stream/asset-1/master.m3u8' });

    expect(fetchPublic).toHaveBeenCalledWith('https://cdn.example/v1/share/asset-1');
  });

  it('prepares and resolves objects through the public map', async () => {
    const { session, fetchFn, fetchPublic } = publicSession();

    await session.prepare('asset-1', { src: SRC });
    await session.resolveObjectId('asset-1', 'd', { src: SRC });

    expect(fetchPublic).toHaveBeenCalledTimes(1);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(h.sharedObject).toHaveBeenCalledWith('sia://pub-d#k');
  });

  it('names the master object from the cached map', async () => {
    const { session, fetchPublic } = publicSession();

    await session.prepare('asset-1', { src: SRC });

    expect(await session.masterObjectId('asset-1', { src: SRC })).toBe('m');
    expect(fetchPublic).toHaveBeenCalledTimes(1);
  });

  it('keeps the api map and the public map apart', async () => {
    const { session, fetchFn, fetchPublic } = publicSession();
    fetchFn.mockResolvedValue(
      shareResponse({
        master_object_id: 'm',
        shares: { d: 'sia://api-d#k' },
        expires_at: inAnHour(),
      }),
    );

    await session.resolveObjectId('asset-1', 'd', { src: SRC });
    await session.resolveObjectId('asset-1', 'd');

    expect(fetchPublic).toHaveBeenCalledTimes(1);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(h.sharedObject).toHaveBeenCalledWith('sia://pub-d#k');
    expect(h.sharedObject).toHaveBeenCalledWith('sia://api-d#k');
  });

  it('refreshes an expiring public map from the public endpoint', async () => {
    const { session, fetchFn, fetchPublic } = publicSession();
    fetchPublic
      .mockResolvedValueOnce(
        shareResponse({
          master_object_id: 'm',
          shares: { d: 'sia://old#k' },
          expires_at: new Date(Date.now() - 1000).toISOString(),
        }),
      )
      .mockResolvedValueOnce(
        shareResponse({
          master_object_id: 'm',
          shares: { d: 'sia://new#k' },
          expires_at: inAnHour(),
        }),
      );

    await session.prepare('asset-1', { src: SRC });
    await session.resolveObjectId('asset-1', 'd', { src: SRC });

    expect(fetchPublic).toHaveBeenCalledTimes(2);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(h.sharedObject).toHaveBeenCalledWith('sia://new#k');
  });
});

describe('SiaSession default public fetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends no credentials and maps a 403 to AuthenticationError', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ error: 'This share map requires a valid signed URL' }), {
          status: 403,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const session = new SiaSession(vi.fn<FetchFn>(), config);

    const err = await session
      .getShareMap('asset-1', { src: 'https://cdn.example/v1/stream/asset-1/master.m3u8' })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(AuthenticationError);
    expect((err as AuthenticationError).statusCode).toBe(403);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://cdn.example/v1/share/asset-1');
    expect(init?.credentials).toBe('omit');
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
  });
});
