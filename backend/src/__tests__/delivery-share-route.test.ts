import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// /v1/share/:id is the unauthenticated share map. The db, indexer and tier
// lookups are mocked; the gate, the expiry rules and the mint cache are real.
vi.mock('../config/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));
vi.mock('../storage/blob-manager.js', () => ({
  getCachedObject: vi.fn(),
  getCacheStats: vi.fn(() => ({})),
}));
vi.mock('../storage/sia-client.js', () => ({
  getObject: vi.fn(),
  downloadObject: vi.fn(),
  shareObjectUrl: vi.fn(),
}));
vi.mock('../delivery/access-control.js', () => ({
  getObjectAccessTier: vi.fn(),
}));
vi.mock('../db/queries/assets.js', () => ({
  getVideoAssetById: vi.fn(),
  getAssetObjectIds: vi.fn(),
}));
vi.mock('../db/queries/playback-ids.js', () => ({
  getPlaybackIdByPublicId: vi.fn(),
}));

const { deliveryRouter } = await import('../delivery/aggregator.js');
const { shareObjectUrl } = await import('../storage/sia-client.js');
const { getObjectAccessTier } = await import('../delivery/access-control.js');
const { getVideoAssetById, getAssetObjectIds } = await import('../db/queries/assets.js');
const { getPlaybackIdByPublicId } = await import('../db/queries/playback-ids.js');
const { buildSignedObjectQuery } = await import('../delivery/signed-url.js');
const { SHARE_EXPIRY_GRID_SEC } = await import('../delivery/share-expiry.js');
const { env } = await import('../config/env.js');

const SECRET = env.SESSION_SECRET;
const PB_PUBLIC = 'pb_aaaaaaaaaaaaaaaaaaaaa';
const PB_SIGNED = 'pb_bbbbbbbbbbbbbbbbbbbbb';

function app() {
  const a = express();
  a.use('/', deliveryRouter);
  return a;
}
const nowSec = () => Math.floor(Date.now() / 1000);
const signed = (objectId: string, expires: number) =>
  buildSignedObjectQuery(objectId, expires, SECRET);

// the mint cache is module state, so every test gets its own asset and master
let seq = 0;
let assetId = '';
let master = '';

function asset(overrides: Record<string, unknown> = {}) {
  return {
    id: assetId,
    manifestObjectId: master,
    accessTier: 'public',
    status: 'ready',
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  seq += 1;
  assetId = `asset-${seq}`;
  master = `master-${seq}`;
  vi.mocked(getVideoAssetById).mockResolvedValue(asset());
  vi.mocked(getObjectAccessTier).mockResolvedValue('public');
  vi.mocked(getPlaybackIdByPublicId).mockResolvedValue(undefined);
  vi.mocked(getAssetObjectIds).mockImplementation(async () => [master, `data-${seq}`]);
  vi.mocked(shareObjectUrl).mockImplementation(
    async (id: string, validUntil: Date) => `sia://indexer/objects/${id}/shared?v=${+validUntil}`,
  );
});

describe('/v1/share/:id gate', () => {
  it('serves a public asset with no credentials, briefly cacheable, with open cors', async () => {
    const res = await request(app()).get(`/v1/share/${assetId}`);

    expect(res.status).toBe(200);
    expect(res.body.master_object_id).toBe(master);
    expect(Object.keys(res.body.shares).sort()).toEqual([`data-${seq}`, master].sort());
    expect(res.headers['access-control-allow-origin']).toBe('*');
    const maxAge = Number(/max-age=(\d+)/.exec(res.headers['cache-control'])?.[1]);
    expect(res.headers['cache-control']).toMatch(/^public, max-age=\d+$/);
    expect(maxAge).toBeGreaterThan(0);
    expect(maxAge).toBeLessThanOrEqual(60);
    // the cached copy cannot outlive the shares
    expect(nowSec() + maxAge).toBeLessThan(Date.parse(res.body.expires_at) / 1000);
    expect(getVideoAssetById).toHaveBeenCalledWith(assetId);
  });

  it('serves a public-policy playback id with no credentials', async () => {
    vi.mocked(getPlaybackIdByPublicId).mockResolvedValue({
      videoAssetId: assetId,
      policy: 'public',
    } as never);

    const res = await request(app()).get(`/v1/share/${PB_PUBLIC}`);

    expect(res.status).toBe(200);
    expect(getVideoAssetById).toHaveBeenCalledWith(assetId);
  });

  it('rejects a private asset without a signature', async () => {
    vi.mocked(getVideoAssetById).mockResolvedValue(asset({ accessTier: 'private' }));

    const res = await request(app()).get(`/v1/share/${assetId}`);

    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('missing');
    expect(res.headers['access-control-allow-origin']).toBe('*');
    expect(shareObjectUrl).not.toHaveBeenCalled();
  });

  it('serves a private asset with a valid signature, no-store, inside the signature', async () => {
    vi.mocked(getVideoAssetById).mockResolvedValue(asset({ accessTier: 'private' }));
    const expires = nowSec() + 3600;

    const res = await request(app()).get(`/v1/share/${assetId}?${signed(master, expires)}`);

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(Date.parse(res.body.expires_at) / 1000).toBeLessThanOrEqual(expires);
  });

  it('clamps the share expiry to a signature that ends sooner than the cap', async () => {
    vi.mocked(getVideoAssetById).mockResolvedValue(asset({ accessTier: 'private' }));
    const expires = nowSec() + 100;

    const res = await request(app()).get(
      `/v1/share/${assetId}?${signed(master, expires)}&expires_in=3600`,
    );

    expect(res.status).toBe(200);
    const shareExpiry = Date.parse(res.body.expires_at) / 1000;
    expect(shareExpiry).toBeLessThanOrEqual(expires);
    expect(shareExpiry).toBeGreaterThan(nowSec());
    // the urls themselves were minted with that expiry, not just the label
    const validUntil = vi.mocked(shareObjectUrl).mock.calls[0][1] as Date;
    expect(validUntil.getTime() / 1000).toBeLessThanOrEqual(expires);
  });

  it('caps a gated share map at an hour even under a longer signature', async () => {
    vi.mocked(getVideoAssetById).mockResolvedValue(asset({ accessTier: 'private' }));
    const expires = nowSec() + 86400;

    const res = await request(app()).get(
      `/v1/share/${assetId}?${signed(master, expires)}&expires_in=21600`,
    );

    expect(res.status).toBe(200);
    expect(Date.parse(res.body.expires_at) / 1000).toBeLessThanOrEqual(nowSec() + 3600);
  });

  it('rejects an expired signature', async () => {
    vi.mocked(getVideoAssetById).mockResolvedValue(asset({ accessTier: 'private' }));
    const expires = nowSec() - 5;

    const res = await request(app()).get(`/v1/share/${assetId}?${signed(master, expires)}`);

    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('expired');
    expect(shareObjectUrl).not.toHaveBeenCalled();
  });

  it('rejects a signature over a different object', async () => {
    vi.mocked(getVideoAssetById).mockResolvedValue(asset({ accessTier: 'private' }));

    const res = await request(app()).get(
      `/v1/share/${assetId}?${signed('some-other-object', nowSec() + 3600)}`,
    );

    expect(res.status).toBe(403);
    expect(res.body.reason).toBe('invalid');
  });

  it('enforces a signed-policy playback id on a public asset', async () => {
    vi.mocked(getPlaybackIdByPublicId).mockResolvedValue({
      videoAssetId: assetId,
      policy: 'signed',
    } as never);

    const unsigned = await request(app()).get(`/v1/share/${PB_SIGNED}`);
    expect(unsigned.status).toBe(403);

    const expires = nowSec() + 1800;
    const ok = await request(app()).get(`/v1/share/${PB_SIGNED}?${signed(master, expires)}`);
    expect(ok.status).toBe(200);
    expect(ok.headers['cache-control']).toBe('private, no-store');
    expect(Date.parse(ok.body.expires_at) / 1000).toBeLessThanOrEqual(expires);
  });

  it('gates a public asset that has a signed handle when asked by asset id', async () => {
    // the gateway gates its objects (tier private), so the share map must too
    vi.mocked(getObjectAccessTier).mockResolvedValue('private');

    const res = await request(app()).get(`/v1/share/${assetId}`);

    expect(res.status).toBe(403);
  });

  it('answers 404 for an asset that is not ready', async () => {
    vi.mocked(getVideoAssetById).mockResolvedValue(asset({ status: 'processing' }));

    const res = await request(app()).get(`/v1/share/${assetId}`);

    expect(res.status).toBe(404);
    expect(shareObjectUrl).not.toHaveBeenCalled();
  });

  it('answers 404 for an asset without a manifest yet', async () => {
    vi.mocked(getVideoAssetById).mockResolvedValue(asset({ manifestObjectId: null }));

    expect((await request(app()).get(`/v1/share/${assetId}`)).status).toBe(404);
  });

  it('answers 404 for a missing or deleted asset', async () => {
    // getVideoAssetById hides soft-deleted rows
    vi.mocked(getVideoAssetById).mockResolvedValue(undefined);
    expect((await request(app()).get(`/v1/share/${assetId}`)).status).toBe(404);

    // and a deletion in progress resolves the objects to 'gone'
    vi.mocked(getVideoAssetById).mockResolvedValue(asset());
    vi.mocked(getObjectAccessTier).mockResolvedValue('gone');
    expect((await request(app()).get(`/v1/share/${assetId}`)).status).toBe(404);
    expect(shareObjectUrl).not.toHaveBeenCalled();
  });

  it('answers 404 for an unknown playback id', async () => {
    const res = await request(app()).get(`/v1/share/${PB_PUBLIC}`);

    expect(res.status).toBe(404);
    expect(getVideoAssetById).not.toHaveBeenCalled();
  });

  it('answers 502 when the indexer fails while minting', async () => {
    vi.mocked(shareObjectUrl).mockRejectedValue(new Error('indexer down'));

    const res = await request(app()).get(`/v1/share/${assetId}`);

    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/Sia indexer/);
  });
});

describe('/v1/share/:id indexer load', () => {
  it('mints once for many requests', async () => {
    for (let i = 0; i < 100; i++) {
      expect((await request(app()).get(`/v1/share/${assetId}`)).status).toBe(200);
    }
    expect(getAssetObjectIds).toHaveBeenCalledTimes(1);
    expect(shareObjectUrl).toHaveBeenCalledTimes(2);
  });

  it('mints once for concurrent requests on a cold cache', async () => {
    // hold the first mint open long enough for every request to arrive
    vi.mocked(getAssetObjectIds).mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 300));
      return [master];
    });
    const results = await Promise.all(
      Array.from({ length: 40 }, () => request(app()).get(`/v1/share/${assetId}`)),
    );
    for (const r of results) expect(r.status).toBe(200);
    expect(getAssetObjectIds).toHaveBeenCalledTimes(1);
  });

  it('keeps indexer calls bounded when the caller varies expires_in', async () => {
    for (let req = 60; req <= 21600; req += 97) {
      const res = await request(app()).get(`/v1/share/${assetId}?expires_in=${req}`);
      expect(res.status).toBe(200);
    }
    // at most one mint per five-minute expiry slot under the six-hour cap
    // (plus one if the sweep crosses a slot boundary)
    const slots = Math.ceil(21600 / SHARE_EXPIRY_GRID_SEC) + 2;
    expect(vi.mocked(getAssetObjectIds).mock.calls.length).toBeLessThanOrEqual(slots);
  });
});
