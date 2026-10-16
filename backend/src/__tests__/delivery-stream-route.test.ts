import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// /v1/stream resolves a playback id / asset and serves the master manifest.
// The db and the indexer are mocked; the gate, the signing and the memory
// cache are real.
vi.mock('../config/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));
vi.mock('../storage/sia-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../storage/sia-client.js')>()),
  openObject: vi.fn(),
}));
vi.mock('../delivery/access-control.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../delivery/access-control.js')>()),
  resolveObjectAccess: vi.fn(),
}));
vi.mock('../db/queries/assets.js', () => ({
  getVideoAssetById: vi.fn(),
}));
vi.mock('../db/queries/playback-ids.js', () => ({
  getPlaybackIdByPublicId: vi.fn(),
  resolveAssetId: vi.fn(),
}));

const { deliveryRouter } = await import('../delivery/aggregator.js');
const { openObject } = await import('../storage/sia-client.js');
const { resolveObjectAccess } = await import('../delivery/access-control.js');
const { getVideoAssetById } = await import('../db/queries/assets.js');
const { getPlaybackIdByPublicId } = await import('../db/queries/playback-ids.js');
const { verifyObjectAccess, buildSignedObjectQuery } = await import('../delivery/signed-url.js');
const { env } = await import('../config/env.js');

const SECRET = env.SESSION_SECRET;
const PB_PUBLIC = 'pb_aaaaaaaaaaaaaaaaaaaaa';
const PB_SIGNED = 'pb_bbbbbbbbbbbbbbbbbbbbb';
const ASSET = '00000000-0000-4000-8000-000000000001';
const MASTER = 'a1'.repeat(32);
const VARIANT = 'b2'.repeat(32);
const MASTER_TEXT = `#EXTM3U\nhttps://cdn.example/v1/objects/${VARIANT}\n`;

function app() {
  const a = express();
  a.use('/', deliveryRouter);
  return a;
}
const nowSec = () => Math.floor(Date.now() / 1000);
const q = (id: string, exp: number, generation = 0) =>
  buildSignedObjectQuery(id, exp, generation, SECRET);

function asset(overrides: Record<string, unknown> = {}) {
  return {
    id: ASSET,
    manifestObjectId: MASTER,
    accessTier: 'public',
    status: 'ready',
    signingGeneration: 0,
    legacySignaturesUntil: null,
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  const bytes = new TextEncoder().encode(MASTER_TEXT);
  vi.mocked(openObject).mockResolvedValue({
    id: MASTER,
    size: bytes.length,
    read: () =>
      new ReadableStream({
        start(c) {
          c.enqueue(bytes);
          c.close();
        },
      }),
  });
  vi.mocked(getPlaybackIdByPublicId).mockResolvedValue(undefined);
  vi.mocked(getVideoAssetById).mockResolvedValue(asset());
});

describe('/v1/stream tier + policy enforcement', () => {
  it('serves a public asset manifest without a signature, briefly kept by nginx', async () => {
    const res = await request(app()).get(`/v1/stream/${ASSET}/master.m3u8`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('mpegurl');
    expect(res.text).toContain(`/v1/objects/${VARIANT}`);
    expect(res.text).not.toContain('sig=');
    expect(res.headers['cache-control']).toBe('public, no-cache');
    expect(res.headers['x-accel-expires']).toBe('60');
    expect(res.headers['etag']).toBe(`"${MASTER}"`);
  });

  it('answers a revalidation with 304 while public and 403 once private', async () => {
    const fresh = await request(app())
      .get(`/v1/stream/${ASSET}/master.m3u8`)
      .set('If-None-Match', `"${MASTER}"`);
    expect(fresh.status).toBe(304);

    vi.mocked(getVideoAssetById).mockResolvedValue(asset({ accessTier: 'private' }));
    const priv = await request(app())
      .get(`/v1/stream/${ASSET}/master.m3u8`)
      .set('If-None-Match', `"${MASTER}"`);
    expect(priv.status).toBe(403);
    expect(priv.headers['cache-control']).toBe('no-store');
  });

  it('rejects a private asset manifest with no signature', async () => {
    vi.mocked(getVideoAssetById).mockResolvedValue(asset({ accessTier: 'private' }));
    const res = await request(app()).get(`/v1/stream/${ASSET}/master.m3u8`);
    expect(res.status).toBe(403);
  });

  it('serves a private asset manifest with a valid signature and signs the graph', async () => {
    vi.mocked(getVideoAssetById).mockResolvedValue(
      asset({ accessTier: 'private', signingGeneration: 4 }),
    );

    const expires = nowSec() + 3600;
    const res = await request(app()).get(
      `/v1/stream/${ASSET}/master.m3u8?${q(MASTER, expires, 4)}`,
    );

    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const m = res.text.match(new RegExp(`/v1/objects/${VARIANT}\\?expires=(\\d+)&sig=([0-9a-f]+)`));
    expect(m).not.toBeNull();
    const state = { generation: 4, legacyUntilSec: null };
    expect(verifyObjectAccess(VARIANT, m![1], m![2], state, SECRET, expires - 1)).toEqual({
      ok: true,
      expiresAtSec: expires,
    });

    // a url of an earlier generation was revoked
    const old = await request(app()).get(
      `/v1/stream/${ASSET}/master.m3u8?${q(MASTER, expires, 3)}`,
    );
    expect(old.status).toBe(403);
  });

  it('honours a url signed before generations only inside the legacy window', async () => {
    const { createHmac } = await import('node:crypto');
    const expires = nowSec() + 10 * 365 * 86400;
    const sig = createHmac('sha256', SECRET).update(`${MASTER}:${expires}`).digest('hex');
    const until = new Date((nowSec() + 1800) * 1000);
    vi.mocked(getVideoAssetById).mockResolvedValue(
      asset({ accessTier: 'private', legacySignaturesUntil: until }),
    );

    const res = await request(app()).get(
      `/v1/stream/${ASSET}/master.m3u8?expires=${expires}&sig=${sig}`,
    );
    expect(res.status).toBe(200);
    // the children are signed no further than the window
    const m = res.text.match(/expires=(\d+)/);
    expect(Number(m![1])).toBe(Math.floor(until.getTime() / 1000));

    vi.mocked(getVideoAssetById).mockResolvedValue(
      asset({ accessTier: 'private', legacySignaturesUntil: null }),
    );
    const closed = await request(app()).get(
      `/v1/stream/${ASSET}/master.m3u8?expires=${expires}&sig=${sig}`,
    );
    expect(closed.status).toBe(403);
  });

  it('gates a signed-policy playback id even when the asset tier is public', async () => {
    vi.mocked(getPlaybackIdByPublicId).mockResolvedValue({
      videoAssetId: ASSET,
      policy: 'signed',
    } as never);

    const res = await request(app()).get(`/v1/stream/${PB_SIGNED}/master.m3u8`);
    expect(res.status).toBe(403);

    const expires = nowSec() + 600;
    const ok = await request(app()).get(
      `/v1/stream/${PB_SIGNED}/master.m3u8?${q(MASTER, expires)}`,
    );
    expect(ok.status).toBe(200);
    expect(ok.headers['cache-control']).toBe('no-store');
    expect(ok.text).toContain(`/v1/objects/${VARIANT}?expires=${expires}&sig=`);
  });

  it('keeps public embeds of the same asset playing next to a signed handle', async () => {
    // the asset is public with one signed and one public handle
    vi.mocked(getPlaybackIdByPublicId).mockImplementation(
      async (pb: string) =>
        ({ videoAssetId: ASSET, policy: pb === PB_SIGNED ? 'signed' : 'public' }) as never,
    );
    vi.mocked(resolveObjectAccess).mockResolvedValue({ kind: 'public', assetId: ASSET });

    for (const entry of [PB_PUBLIC, ASSET]) {
      const master = await request(app()).get(`/v1/stream/${entry}/master.m3u8`);
      expect(master.status, entry).toBe(200);
      // the unsigned child the player follows next is served, not refused
      const child = await request(app()).get(`/v1/objects/${VARIANT}`);
      expect(child.status, entry).not.toBe(403);
    }
  });

  it('returns 404 for an unknown playback id, or a path that is no id at all', async () => {
    expect((await request(app()).get(`/v1/stream/${PB_PUBLIC}/master.m3u8`)).status).toBe(404);
    expect((await request(app()).get('/v1/stream/asset-1/master.m3u8')).status).toBe(404);
    expect(getVideoAssetById).not.toHaveBeenCalled();
  });

  it('returns 503 when the database fails, 502 when the indexer does', async () => {
    vi.mocked(getVideoAssetById).mockRejectedValueOnce(new Error('connection refused'));
    expect((await request(app()).get(`/v1/stream/${ASSET}/master.m3u8`)).status).toBe(503);

    vi.mocked(getVideoAssetById).mockResolvedValue(asset({ manifestObjectId: 'c3'.repeat(32) }));
    vi.mocked(openObject).mockRejectedValueOnce(new Error('dial tcp: i/o timeout'));
    expect((await request(app()).get(`/v1/stream/${ASSET}/master.m3u8`)).status).toBe(502);
  });
});
