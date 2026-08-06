import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// /v1/stream resolves a playback id / asset and serves the master manifest.
// Mock the DB and blob layers so the test drives the tier + policy gating.
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
}));
vi.mock('../delivery/access-control.js', () => ({
  getObjectAccessTier: vi.fn(async () => 'public'),
}));
vi.mock('../db/queries/assets.js', () => ({
  getVideoAssetById: vi.fn(),
}));
vi.mock('../db/queries/playback-ids.js', () => ({
  getPlaybackIdByPublicId: vi.fn(),
  resolveAssetId: vi.fn(),
}));

const { deliveryRouter } = await import('../delivery/aggregator.js');
const { getCachedObject } = await import('../storage/blob-manager.js');
const { getVideoAssetById } = await import('../db/queries/assets.js');
const { getPlaybackIdByPublicId } = await import('../db/queries/playback-ids.js');
const { verifyObjectAccess, buildSignedObjectQuery } = await import('../delivery/signed-url.js');
const { env } = await import('../config/env.js');

const SECRET = env.SESSION_SECRET;
const MASTER = '#EXTM3U\nhttps://cdn.example/v1/objects/variant1\n';
const PB_PUBLIC = 'pb_aaaaaaaaaaaaaaaaaaaaa';
const PB_SIGNED = 'pb_bbbbbbbbbbbbbbbbbbbbb';

function app() {
  const a = express();
  a.use('/', deliveryRouter);
  return a;
}
const nowSec = () => Math.floor(Date.now() / 1000);
const q = (id: string, exp: number) => buildSignedObjectQuery(id, exp, SECRET);

beforeEach(() => {
  vi.mocked(getCachedObject).mockResolvedValue({
    data: new TextEncoder().encode(MASTER),
    status: 'MISS' as const,
  });
  vi.mocked(getPlaybackIdByPublicId).mockResolvedValue(undefined);
});

describe('/v1/stream tier + policy enforcement', () => {
  it('serves a public asset manifest without a signature', async () => {
    vi.mocked(getVideoAssetById).mockResolvedValue({
      manifestObjectId: 'master1',
      accessTier: 'public',
    } as never);

    const res = await request(app()).get('/v1/stream/asset-public/master.m3u8');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('mpegurl');
    expect(res.text).toContain('/v1/objects/variant1');
    expect(res.text).not.toContain('sig=');
  });

  it('rejects a private asset manifest with no signature', async () => {
    vi.mocked(getVideoAssetById).mockResolvedValue({
      manifestObjectId: 'master1',
      accessTier: 'private',
    } as never);

    const res = await request(app()).get('/v1/stream/asset-private/master.m3u8');

    expect(res.status).toBe(403);
  });

  it('serves a private asset manifest with a valid signature and signs the graph', async () => {
    vi.mocked(getVideoAssetById).mockResolvedValue({
      manifestObjectId: 'master1',
      accessTier: 'private',
    } as never);

    const expires = nowSec() + 3600;
    const res = await request(app()).get(
      `/v1/stream/asset-private/master.m3u8?${q('master1', expires)}`,
    );

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const m = res.text.match(/\/v1\/objects\/variant1\?expires=(\d+)&sig=([0-9a-f]+)/);
    expect(m).not.toBeNull();
    expect(verifyObjectAccess('variant1', m![1], m![2], SECRET, expires - 1)).toEqual({
      ok: true,
    });
  });

  it('enforces a signed-policy playback id even when the asset tier is public', async () => {
    vi.mocked(getPlaybackIdByPublicId).mockResolvedValue({
      videoAssetId: 'asset-public',
      policy: 'signed',
    } as never);
    vi.mocked(getVideoAssetById).mockResolvedValue({
      manifestObjectId: 'master1',
      accessTier: 'public',
    } as never);

    const res = await request(app()).get(`/v1/stream/${PB_SIGNED}/master.m3u8`);

    expect(res.status).toBe(403);
  });

  it('serves a public-policy playback id without a signature', async () => {
    vi.mocked(getPlaybackIdByPublicId).mockResolvedValue({
      videoAssetId: 'asset-public',
      policy: 'public',
    } as never);
    vi.mocked(getVideoAssetById).mockResolvedValue({
      manifestObjectId: 'master1',
      accessTier: 'public',
    } as never);

    const res = await request(app()).get(`/v1/stream/${PB_PUBLIC}/master.m3u8`);

    expect(res.status).toBe(200);
  });

  it('returns 404 for an unknown playback id', async () => {
    vi.mocked(getPlaybackIdByPublicId).mockResolvedValue(undefined);

    const res = await request(app()).get(`/v1/stream/${PB_PUBLIC}/master.m3u8`);

    expect(res.status).toBe(404);
  });
});
