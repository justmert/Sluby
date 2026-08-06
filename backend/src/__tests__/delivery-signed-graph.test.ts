import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// The delivery gateway pulls object bytes and access tiers from these
// modules; mock them so the test drives the routing + signing logic with
// deterministic data. signed-url, content-type and env stay real.
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
  getObjectAccessTier: vi.fn(),
}));

const { deliveryRouter } = await import('../delivery/aggregator.js');
const { getCachedObject } = await import('../storage/blob-manager.js');
const { getObject, downloadObject } = await import('../storage/sia-client.js');
const { getObjectAccessTier } = await import('../delivery/access-control.js');
const { verifyObjectAccess, buildSignedObjectQuery } = await import(
  '../delivery/signed-url.js'
);
const { env } = await import('../config/env.js');

const SECRET = env.SESSION_SECRET;

/** A private master manifest that references one variant playlist object. */
const MASTER = [
  '#EXTM3U',
  '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360',
  'https://cdn.example/v1/objects/variant1',
  '',
].join('\n');

/** The variant playlist referencing the single media data object. */
const VARIANT = [
  '#EXTM3U',
  '#EXT-X-MAP:URI="https://cdn.example/v1/objects/data1",BYTERANGE="16@0"',
  '#EXTINF:1.0,',
  '#EXT-X-BYTERANGE:16@16',
  'https://cdn.example/v1/objects/data1',
  '#EXT-X-ENDLIST',
  '',
].join('\n');

const DATA = new Uint8Array(Array.from({ length: 48 }, (_, i) => i));

function app() {
  const a = express();
  a.use('/', deliveryRouter);
  return a;
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function signedQuery(objectId: string, expiresAtSec: number) {
  return buildSignedObjectQuery(objectId, expiresAtSec, SECRET);
}

beforeEach(() => {
  vi.mocked(getObjectAccessTier).mockImplementation(async (id: string) =>
    id.startsWith('pub') ? 'public' : 'private',
  );
  vi.mocked(getCachedObject).mockImplementation(async (id: string) => {
    if (id === 'master1' || id === 'pubmaster') {
      return { data: new TextEncoder().encode(MASTER), status: 'MISS' as const };
    }
    if (id === 'variant1') {
      return { data: new TextEncoder().encode(VARIANT), status: 'MISS' as const };
    }
    return { data: new TextEncoder().encode('#EXTM3U\n'), status: 'MISS' as const };
  });
  vi.mocked(getObject).mockResolvedValue({ size: () => BigInt(DATA.length) } as never);
  vi.mocked(downloadObject).mockImplementation(async (_id, opts) => {
    const start = Number(opts?.offset ?? 0);
    const length = Number(opts?.length ?? DATA.length);
    return DATA.subarray(start, start + length);
  });
});

describe('signed HLS object graph', () => {
  it('signs the child URLs of a private manifest so the whole graph is authorized', async () => {
    const expires = nowSec() + 3600;
    const res = await request(app()).get(
      `/v1/objects/master1?type=manifest&${signedQuery('master1', expires)}`,
    );

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('mpegurl');
    // A private manifest must never be stored by a shared cache.
    expect(res.headers['cache-control']).toBe('no-store');

    // The embedded variant URL now carries a signature that verifies at the
    // same expiry, so the player can fetch it without a fresh signing call.
    const m = res.text.match(/\/v1\/objects\/variant1\?expires=(\d+)&sig=([0-9a-f]+)/);
    expect(m).not.toBeNull();
    const [, exp, sig] = m!;
    expect(exp).toBe(String(expires));
    expect(verifyObjectAccess('variant1', exp, sig, SECRET, expires - 1)).toEqual({
      ok: true,
    });
  });

  it('rejects a private object with no signature', async () => {
    const res = await request(app()).get('/v1/objects/master1?type=manifest');
    expect(res.status).toBe(403);
  });

  it('rejects a private object with an expired signature', async () => {
    const expired = nowSec() - 10;
    const res = await request(app()).get(
      `/v1/objects/master1?type=manifest&${signedQuery('master1', expired)}`,
    );
    expect(res.status).toBe(403);
  });

  it('serves a public manifest as-is, with child URLs left unsigned', async () => {
    const res = await request(app()).get('/v1/objects/pubmaster?type=manifest');

    expect(res.status).toBe(200);
    expect(res.text).toContain('/v1/objects/variant1');
    expect(res.text).not.toContain('sig=');
    expect(res.headers['cache-control']).toContain('max-age');
  });

  it('lets a player walk master -> variant -> media range from one signed link', async () => {
    const a = app();
    const expires = nowSec() + 3600;

    // 1) Master: signed link in, signed variant link out.
    const master = await request(a).get(
      `/v1/objects/master1?type=manifest&${signedQuery('master1', expires)}`,
    );
    expect(master.status).toBe(200);
    const variantPath = extractObjectPath(master.text, 'variant1');
    expect(variantPath).not.toBeNull();

    // 2) Variant: the gateway signs its media child too.
    const variant = await request(a).get(variantPath!);
    expect(variant.status).toBe(200);
    const dataPath = extractObjectPath(variant.text, 'data1');
    expect(dataPath).not.toBeNull();

    // 3) Media: a byte range is served as 206 with the exact requested window.
    const media = await request(a).get(dataPath!).set('Range', 'bytes=16-31');
    expect(media.status).toBe(206);
    expect(media.headers['content-range']).toBe('bytes 16-31/48');
    expect(media.headers['content-length']).toBe('16');
    expect(media.headers['cache-control']).toBe('no-store');

    // The same media object without a signature is refused.
    const unsigned = await request(a).get('/v1/objects/data1').set('Range', 'bytes=16-31');
    expect(unsigned.status).toBe(403);
  });
});

/** Pull the gateway path (`/v1/objects/{id}?...`) for one object from a body. */
function extractObjectPath(body: string, id: string): string | null {
  const m = body.match(new RegExp(`/v1/objects/${id}\\?[^"\\s]*`));
  return m ? m[0] : null;
}
