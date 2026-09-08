import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FetchFn } from './uploads.js';

// Shared mock surface for the (lazily imported) sia-storage WASM SDK.
const h = vi.hoisted(() => {
  const initSia = vi.fn().mockResolvedValue(undefined);
  const sharedObject = vi.fn();
  const download = vi.fn();
  const fakeSdk = { sharedObject, download };
  const state: { connectedResult: unknown } = { connectedResult: fakeSdk };
  const connected = vi.fn(async () => state.connectedResult);
  const builderCtor = vi.fn();
  const appKeyCtor = vi.fn();
  return { initSia, sharedObject, download, fakeSdk, state, connected, builderCtor, appKeyCtor };
});

vi.mock('sia-storage', () => {
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

import { SiaSession } from './sia-session.js';

const config = { indexerUrl: 'https://sia.storage', appId: 'app-id-hex', appKey: 'aabbccdd' };

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
      appId: 'app-id-hex',
      name: 'Sluby Player',
      description: 'Sluby direct-from-Sia video player',
      serviceUrl: 'https://sia.storage',
      logoUrl: undefined,
      callbackUrl: undefined,
    });
    // 'aabbccdd' -> [0xaa, 0xbb, 0xcc, 0xdd]
    expect(h.appKeyCtor).toHaveBeenCalledWith(new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]));
    expect(sdk).toBe(h.fakeSdk);
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

describe('SiaSession.resolveObject', () => {
  it('resolves a share URL via the SDK and caches per URL', async () => {
    const { session } = makeSession();

    const a1 = await session.resolveObject('sia://x#k');
    const a2 = await session.resolveObject('sia://x#k');
    await session.resolveObject('sia://y#k');

    expect(a1).toBe(a2);
    // 'x' resolved once (cached), 'y' once more.
    expect(h.sharedObject).toHaveBeenCalledTimes(2);
    expect(h.sharedObject).toHaveBeenCalledWith('sia://x#k');
    expect(h.sharedObject).toHaveBeenCalledWith('sia://y#k');
  });
});

describe('SiaSession.download', () => {
  it('throws if called before connect', () => {
    const { session } = makeSession();
    expect(() => session.download({} as never, { offset: 0, length: 1 })).toThrow(/before connect/);
  });

  it('passes numeric offset/length to the SDK after resolve', async () => {
    const { session } = makeSession();
    const obj = await session.resolveObject('sia://x#k');

    const stream = session.download(obj, { offset: 10, length: 20 });

    expect(h.download).toHaveBeenCalledWith(obj, { offset: 10, length: 20 });
    expect(stream).toBe('fake-stream');
  });
});
