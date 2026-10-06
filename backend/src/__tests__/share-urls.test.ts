import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../db/queries/assets.js', () => ({ getAssetObjectIds: vi.fn() }));
vi.mock('../storage/sia-client.js', () => ({ shareObjectUrl: vi.fn() }));

import { createAssetShareUrls } from '../delivery/share-urls.js';
import {
  shareExpiryBounds,
  shareExpirySec,
  SHARE_EXPIRY_GRID_SEC,
} from '../delivery/share-expiry.js';
import { getAssetObjectIds } from '../db/queries/assets.js';
import { shareObjectUrl } from '../storage/sia-client.js';

const mockedIds = vi.mocked(getAssetObjectIds);
const mockedShare = vi.mocked(shareObjectUrl);

const nowSec = () => Math.floor(Date.now() / 1000);
// every test uses its own asset id, the cache is module state
let assetSeq = 0;
const nextAsset = () => `asset-${++assetSeq}`;

beforeEach(() => {
  vi.clearAllMocks();
  mockedShare.mockImplementation(async (objectId: string) => `sia://${objectId}#key`);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('shareExpirySec', () => {
  const now = 1_800_000_010; // 10s past a grid line

  it('rounds the requested lifetime up to the grid', () => {
    const t = shareExpirySec(now, 3600, now + 21600);
    expect(t % SHARE_EXPIRY_GRID_SEC).toBe(0);
    expect(t).toBeGreaterThanOrEqual(now + 3600);
    expect(t).toBeLessThan(now + 3600 + SHARE_EXPIRY_GRID_SEC);
  });

  it('rounds down instead when rounding up would pass the hard limit', () => {
    const t = shareExpirySec(now, 3600, now + 3600);
    expect(t % SHARE_EXPIRY_GRID_SEC).toBe(0);
    expect(t).toBeLessThanOrEqual(now + 3600);
    expect(t).toBeGreaterThan(now + 3600 - SHARE_EXPIRY_GRID_SEC);
  });

  it('uses the hard limit itself when the grid would leave almost no lifetime', () => {
    // a signature expiring 100s from now: the grid line below it is in the past
    expect(shareExpirySec(now, 3600, now + 100)).toBe(now + 100);
  });

  it('gives every expires_in inside one slot the same expiry', () => {
    const slots = new Set<number>();
    for (let req = 60; req <= 21600; req += 1) slots.add(shareExpirySec(now, req, now + 21600));
    // 21540 different requests collapse to one expiry per five minutes
    expect(slots.size).toBeLessThanOrEqual(Math.ceil(21600 / SHARE_EXPIRY_GRID_SEC) + 1);
  });
});

describe('shareExpiryBounds', () => {
  const now = 1_800_000_000;

  it('defaults to an hour and caps public at six hours', () => {
    expect(shareExpiryBounds(undefined, false, now)).toEqual({
      expiresIn: 3600,
      notAfterSec: now + 21600,
    });
    expect(shareExpiryBounds('999999', false, now).expiresIn).toBe(21600);
    expect(shareExpiryBounds('5', false, now).expiresIn).toBe(60);
  });

  it('caps gated at one hour', () => {
    expect(shareExpiryBounds('999999', true, now)).toEqual({
      expiresIn: 3600,
      notAfterSec: now + 3600,
    });
  });

  it('never lets the hard limit pass a signature expiry', () => {
    expect(shareExpiryBounds('3600', true, now, now + 600).notAfterSec).toBe(now + 600);
    // a signature that outlives the cap leaves the cap in charge
    expect(shareExpiryBounds('3600', true, now, now + 99999).notAfterSec).toBe(now + 3600);
  });
});

describe('createAssetShareUrls', () => {
  it('mints one share URL per object and echoes the master + expiry', async () => {
    mockedIds.mockResolvedValue(['manifest-obj', 'data-obj', 'thumb-obj']);

    const before = Date.now();
    const result = await createAssetShareUrls(nextAsset(), 'manifest-obj', 3600, nowSec() + 21600);

    expect(result.masterObjectId).toBe('manifest-obj');
    expect(result.shares).toEqual({
      'manifest-obj': 'sia://manifest-obj#key',
      'data-obj': 'sia://data-obj#key',
      'thumb-obj': 'sia://thumb-obj#key',
    });
    expect(mockedShare).toHaveBeenCalledTimes(3);
    // every object is shared with the same validUntil, at least now + expiresIn
    const validUntil = mockedShare.mock.calls[0][1] as Date;
    expect(validUntil.getTime()).toBeGreaterThanOrEqual(before + 3600_000 - 1000);
    expect(validUntil.getTime()).toBeLessThanOrEqual(
      before + (3600 + SHARE_EXPIRY_GRID_SEC) * 1000,
    );
    expect(new Date(result.expiresAt).getTime()).toBe(validUntil.getTime());
    for (const call of mockedShare.mock.calls) expect(call[1]).toEqual(validUntil);
  });

  it('never mints past the hard limit', async () => {
    mockedIds.mockResolvedValue(['a']);
    const limit = nowSec() + 700;

    const result = await createAssetShareUrls(nextAsset(), 'a', 3600, limit);

    expect(Date.parse(result.expiresAt) / 1000).toBeLessThanOrEqual(limit);
  });

  it('serves a cached map for repeat calls (no re-mint)', async () => {
    mockedIds.mockResolvedValue(['a', 'b']);
    const asset = nextAsset();

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:15Z'));
    const first = await createAssetShareUrls(asset, 'a', 3600, nowSec() + 21600);
    // well past the old 30s window, but the same expiry slot
    vi.setSystemTime(new Date('2026-01-01T00:02:00Z'));
    const second = await createAssetShareUrls(asset, 'a', 3600, nowSec() + 21600);

    expect(second).toEqual(first);
    expect(mockedShare).toHaveBeenCalledTimes(2);
    expect(mockedIds).toHaveBeenCalledTimes(1);
  });

  it('bounds indexer calls per asset however expires_in is varied', async () => {
    mockedIds.mockResolvedValue(['a', 'b']);
    const asset = nextAsset();

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:15Z'));
    const now = nowSec();
    // what an unauthenticated caller can do: every expires_in, as fast as it likes
    for (let req = 60; req <= 21600; req += 7) {
      const { expiresIn, notAfterSec } = shareExpiryBounds(String(req), false, now);
      await createAssetShareUrls(asset, 'a', expiresIn, notAfterSec);
    }
    const slots = Math.ceil(21600 / SHARE_EXPIRY_GRID_SEC) + 1;
    expect(mockedIds.mock.calls.length).toBeLessThanOrEqual(slots);
    expect(mockedShare.mock.calls.length).toBeLessThanOrEqual(slots * 2);

    // a second sweep is served entirely from the cache
    const minted = mockedShare.mock.calls.length;
    for (let req = 60; req <= 21600; req += 7) {
      const { expiresIn, notAfterSec } = shareExpiryBounds(String(req), false, now);
      await createAssetShareUrls(asset, 'a', expiresIn, notAfterSec);
    }
    expect(mockedShare.mock.calls.length).toBe(minted);
  });

  it('mints once for concurrent requests on a cold cache', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    mockedIds.mockImplementation(async () => {
      await gate;
      return ['a', 'b'];
    });
    const asset = nextAsset();
    const limit = nowSec() + 21600;

    const calls = Array.from({ length: 50 }, () => createAssetShareUrls(asset, 'a', 3600, limit));
    release();
    const results = await Promise.all(calls);

    expect(mockedIds).toHaveBeenCalledTimes(1);
    expect(mockedShare).toHaveBeenCalledTimes(2);
    for (const r of results) expect(r).toBe(results[0]);
  });

  it('does not cache a failed mint', async () => {
    mockedIds.mockResolvedValue(['a']);
    mockedShare.mockRejectedValueOnce(new Error('indexer down'));
    const asset = nextAsset();
    const limit = nowSec() + 21600;

    await expect(createAssetShareUrls(asset, 'a', 3600, limit)).rejects.toThrow('indexer down');
    const ok = await createAssetShareUrls(asset, 'a', 3600, limit);

    expect(ok.shares).toEqual({ a: 'sia://a#key' });
  });

  it('re-mints for a different asset or a new master', async () => {
    mockedIds.mockResolvedValue(['a']);
    const limit = nowSec() + 21600;
    const asset = nextAsset();

    await createAssetShareUrls(asset, 'a', 3600, limit);
    await createAssetShareUrls(nextAsset(), 'a', 3600, limit);
    await createAssetShareUrls(asset, 'a2', 3600, limit);

    expect(mockedIds).toHaveBeenCalledTimes(3);
  });
});
