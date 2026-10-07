import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// /v1/objects/:id end to end through the real router, the real memory cache
// and the real signing code. Only the two edges are stand-ins: the access
// lookup (its sql has a postgres suite of its own) and the indexer, whose
// handles stream from memory here.
vi.mock('../config/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));
vi.mock('../storage/sia-client.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../storage/sia-client.js')>();
  return { ...real, openObject: vi.fn(), shareObjectUrl: vi.fn() };
});
vi.mock('../delivery/access-control.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../delivery/access-control.js')>();
  return { ...real, resolveObjectAccess: vi.fn() };
});

const { deliveryRouter } = await import('../delivery/aggregator.js');
const { openObject } = await import('../storage/sia-client.js');
const { resolveObjectAccess } = await import('../delivery/access-control.js');
const { verifyObjectAccess, buildSignedObjectQuery } = await import('../delivery/signed-url.js');
const { CACHEABLE_OBJECT_MAX_BYTES } = await import('../storage/blob-manager.js');
const { env } = await import('../config/env.js');
const { registry } = await import('../metrics/collector.js');
type ObjectHandle = import('../storage/sia-client.js').ObjectHandle;
type ObjectAccess = import('../delivery/access-control.js').ObjectAccess;

const SECRET = env.SESSION_SECRET;

// every test gets fresh ids: the memory cache is module state
let seq = 0;
const oid = (tag: string) => `${tag}${String(seq).padStart(4, '0')}`.padEnd(64, '0');
let MASTER = '';
let VARIANT = '';
let DATA = '';
let THUMB = '';
let BIG = '';

const DATA_BYTES = new Uint8Array(Array.from({ length: 48 }, (_, i) => i));
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const BIG_SIZE = CACHEABLE_OBJECT_MAX_BYTES + 3 * 65536 + 17;

function masterText() {
  return `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\nhttps://cdn.example/v1/objects/${VARIANT}\n`;
}
function variantText() {
  return (
    `#EXTM3U\n#EXT-X-MAP:URI="https://cdn.example/v1/objects/${DATA}",BYTERANGE="16@0"\n` +
    `#EXTINF:1.0,\n#EXT-X-BYTERANGE:16@16\nhttps://cdn.example/v1/objects/${DATA}\n#EXT-X-ENDLIST\n`
  );
}

/** A handle streaming `bytes` in 2-byte chunks, as the sdk streams in chunks. */
function memoryHandle(id: string, bytes: Uint8Array): ObjectHandle {
  return {
    id,
    size: bytes.length,
    read: vi.fn((range?: { offset: number; length: number }) => {
      const start = range?.offset ?? 0;
      const slice = bytes.subarray(start, range ? start + range.length : bytes.length);
      let at = 0;
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          if (at >= slice.length) return controller.close();
          controller.enqueue(slice.slice(at, at + 2));
          at += 2;
        },
      });
    }),
  };
}

/** A large object whose bytes are made as they are read, so the test holds none of it. */
function largeHandle(id: string, size: number): ObjectHandle {
  return {
    id,
    size,
    read: vi.fn((range?: { offset: number; length: number }) => {
      const length = range?.length ?? size;
      let left = length;
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          if (left === 0) return controller.close();
          const n = Math.min(65536, left);
          left -= n;
          controller.enqueue(new Uint8Array(n).fill(7));
        },
      });
    }),
  };
}

let handles: Map<string, ObjectHandle>;
let access: Map<string, ObjectAccess>;
const PUBLIC = (assetId = 'a'): ObjectAccess => ({ kind: 'public', assetId });
const PRIVATE = (generation = 0): ObjectAccess => ({
  kind: 'private',
  assetId: 'a',
  signing: { generation, legacyUntilSec: null },
});

function app() {
  const a = express();
  a.use('/', deliveryRouter);
  return a;
}
const nowSec = () => Math.floor(Date.now() / 1000);
const signed = (id: string, expires: number, generation = 0) =>
  buildSignedObjectQuery(id, expires, generation, SECRET);

beforeEach(() => {
  vi.clearAllMocks();
  seq += 1;
  MASTER = oid('aa');
  VARIANT = oid('bb');
  DATA = oid('cc');
  THUMB = oid('dd');
  BIG = oid('ee');
  handles = new Map([
    [MASTER, memoryHandle(MASTER, new TextEncoder().encode(masterText()))],
    [VARIANT, memoryHandle(VARIANT, new TextEncoder().encode(variantText()))],
    [DATA, memoryHandle(DATA, DATA_BYTES)],
    [THUMB, memoryHandle(THUMB, JPEG)],
    [BIG, largeHandle(BIG, BIG_SIZE)],
  ]);
  access = new Map();
  vi.mocked(openObject).mockImplementation(async (id: string) => {
    const h = handles.get(id);
    if (!h) throw new Error('app error: Api(404, "object not found\\n")');
    return h;
  });
  vi.mocked(resolveObjectAccess).mockImplementation(
    async (id: string) => access.get(id) ?? { kind: 'unknown' },
  );
});

/** Pull the gateway path (`/v1/objects/{id}?...`) for one object from a body. */
function extractObjectPath(body: string, id: string): string | null {
  const m = body.match(new RegExp(`/v1/objects/${id}\\?[^"\\s]*`));
  return m ? m[0] : null;
}

describe('signed HLS object graph', () => {
  beforeEach(() => {
    for (const id of [MASTER, VARIANT, DATA]) access.set(id, PRIVATE());
  });

  it('signs the child URLs of a private manifest so the whole graph is authorized', async () => {
    const expires = nowSec() + 3600;
    const res = await request(app()).get(
      `/v1/objects/${MASTER}?type=manifest&${signed(MASTER, expires)}`,
    );

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('mpegurl');
    // A private manifest must never be stored by a shared cache.
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['etag']).toBeUndefined();
    expect(res.headers['x-accel-expires']).toBeUndefined();

    const m = res.text.match(new RegExp(`/v1/objects/${VARIANT}\\?expires=(\\d+)&sig=([0-9a-f]+)`));
    expect(m).not.toBeNull();
    expect(m![1]).toBe(String(expires));
    const state = { generation: 0, legacyUntilSec: null };
    expect(verifyObjectAccess(VARIANT, m![1], m![2], state, SECRET, expires - 1)).toEqual({
      ok: true,
      expiresAtSec: expires,
    });
  });

  it('rejects a private object with no signature, an expired one, or one of an older generation', async () => {
    const missing = await request(app()).get(`/v1/objects/${MASTER}?type=manifest`);
    expect(missing.status).toBe(403);
    expect(missing.body.reason).toBe('missing');
    expect(missing.headers['cache-control']).toBe('no-store');

    const expired = await request(app()).get(
      `/v1/objects/${MASTER}?type=manifest&${signed(MASTER, nowSec() - 10)}`,
    );
    expect(expired.status).toBe(403);
    expect(expired.body.reason).toBe('expired');

    // revoked: the asset's generation moved past the one the url was signed with
    access.set(MASTER, PRIVATE(1));
    const revoked = await request(app()).get(
      `/v1/objects/${MASTER}?type=manifest&${signed(MASTER, nowSec() + 3600, 0)}`,
    );
    expect(revoked.status).toBe(403);
    expect(revoked.body.reason).toBe('invalid');
  });

  it('lets a player walk master -> variant -> media range from one signed link', async () => {
    const a = app();
    const expires = nowSec() + 3600;

    const master = await request(a).get(
      `/v1/objects/${MASTER}?type=manifest&${signed(MASTER, expires)}`,
    );
    expect(master.status).toBe(200);
    const variantPath = extractObjectPath(master.text, VARIANT);
    expect(variantPath).not.toBeNull();

    const variant = await request(a).get(variantPath!);
    expect(variant.status).toBe(200);
    const dataPath = extractObjectPath(variant.text, DATA);
    expect(dataPath).not.toBeNull();

    const media = await request(a).get(dataPath!).set('Range', 'bytes=16-31');
    expect(media.status).toBe(206);
    expect(media.headers['content-range']).toBe('bytes 16-31/48');
    expect(media.headers['content-length']).toBe('16');
    expect(media.headers['cache-control']).toBe('no-store');
    expect([...media.body]).toEqual(Array.from({ length: 16 }, (_, i) => i + 16));

    const unsigned = await request(a).get(`/v1/objects/${DATA}`).set('Range', 'bytes=16-31');
    expect(unsigned.status).toBe(403);
  });

  it('still signs the children of a private manifest asked for with an unusable range', async () => {
    const expires = nowSec() + 3600;
    const res = await request(app())
      .get(`/v1/objects/${MASTER}?type=manifest&${signed(MASTER, expires)}`)
      .set('Range', 'bytes=10-5');
    expect(res.status).toBe(200);
    expect(extractObjectPath(res.text, VARIANT)).toContain('sig=');
  });
});

describe('public objects and caching', () => {
  beforeEach(() => {
    for (const id of [MASTER, VARIANT, DATA, THUMB, BIG]) access.set(id, PUBLIC());
  });

  it('marks a small public object for a short shared cache, with a strong etag, revalidated by clients', async () => {
    const res = await request(app()).get(`/v1/objects/${THUMB}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['etag']).toBe(`"${THUMB}"`);
    expect(res.headers['cache-control']).toBe('public, no-cache');
    expect(res.headers['x-accel-expires']).toBe('60');
    // a public manifest is served as is
    const manifest = await request(app()).get(`/v1/objects/${MASTER}?type=manifest`);
    expect(manifest.text).not.toContain('sig=');
  });

  it('answers a revalidation with 304 after checking access again, without touching Sia', async () => {
    await request(app()).get(`/v1/objects/${THUMB}`);
    vi.mocked(openObject).mockClear();

    const fresh = await request(app())
      .get(`/v1/objects/${THUMB}`)
      .set('If-None-Match', `"${THUMB}"`);
    expect(fresh.status).toBe(304);
    expect(fresh.headers['x-accel-expires']).toBe('60');
    expect(openObject).not.toHaveBeenCalled();
    expect(resolveObjectAccess).toHaveBeenCalledTimes(2);

    // made private: the same revalidation is refused
    access.set(THUMB, PRIVATE());
    const priv = await request(app())
      .get(`/v1/objects/${THUMB}`)
      .set('If-None-Match', `"${THUMB}"`);
    expect(priv.status).toBe(403);
    expect(priv.headers['cache-control']).toBe('no-store');

    // deleted: refused as gone
    access.set(THUMB, { kind: 'gone' });
    const gone = await request(app())
      .get(`/v1/objects/${THUMB}`)
      .set('If-None-Match', `"${THUMB}"`);
    expect(gone.status).toBe(404);
    expect(gone.headers['cache-control']).toBe('no-store');
  });

  it('marks ranged public reads revalidated by clients, not kept by nginx', async () => {
    const res = await request(app()).get(`/v1/objects/${DATA}`).set('Range', 'bytes=0-15');
    expect(res.status).toBe(206);
    expect(res.headers['cache-control']).toBe('public, no-cache');
    expect(res.headers['etag']).toBe(`"${DATA}"`);
    expect(res.headers['x-accel-expires']).toBeUndefined();
  });

  it('serves a range of a cached object from memory', async () => {
    await request(app()).get(`/v1/objects/${DATA}`);
    vi.mocked(openObject).mockClear();
    const res = await request(app()).get(`/v1/objects/${DATA}`).set('Range', 'bytes=4-7');
    expect(res.status).toBe(206);
    expect([...res.body]).toEqual([4, 5, 6, 7]);
    expect(res.headers['x-cache-status']).toBe('HIT');
    expect(openObject).not.toHaveBeenCalled();
  });

  it('ignores a range conditional on another version', async () => {
    const res = await request(app())
      .get(`/v1/objects/${DATA}`)
      .set('Range', 'bytes=0-3')
      .set('If-Range', '"something-else"');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(48);
  });

  it('answers 416 past the end, never cacheable by nginx', async () => {
    const res = await request(app()).get(`/v1/objects/${DATA}`).set('Range', 'bytes=48-');
    expect(res.status).toBe(416);
    expect(res.headers['content-range']).toBe('bytes */48');
    expect(res.headers['x-accel-expires']).toBeUndefined();
  });
});

describe('large objects are streamed, never held', () => {
  beforeEach(() => access.set(BIG, PUBLIC()));

  it('answers HEAD from the indexer lookup alone', async () => {
    const res = await request(app()).head(`/v1/objects/${BIG}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBe(String(BIG_SIZE));
    expect(handles.get(BIG)!.read).not.toHaveBeenCalled();
  });

  it('streams a whole-object GET, uncached and not kept by nginx', async () => {
    const res = await request(app()).get(`/v1/objects/${BIG}`).buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBe(String(BIG_SIZE));
    expect(res.body.length).toBe(BIG_SIZE);
    expect(res.headers['x-cache-status']).toBe('BYPASS');
    expect(res.headers['x-accel-expires']).toBeUndefined();
    expect(res.headers['cache-control']).toBe('public, no-cache');
    expect(handles.get(BIG)!.read).toHaveBeenCalledWith();

    // and again: nothing was kept, so it streams from Sia once more
    await request(app()).get(`/v1/objects/${BIG}`).buffer(true);
    expect(handles.get(BIG)!.read).toHaveBeenCalledTimes(2);
  });

  it('streams an open-ended range as one 206 of the rest', async () => {
    const res = await request(app())
      .get(`/v1/objects/${BIG}`)
      .set('Range', 'bytes=0-')
      .buffer(true);
    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe(`bytes 0-${BIG_SIZE - 1}/${BIG_SIZE}`);
    expect(res.body.length).toBe(BIG_SIZE);
    expect(handles.get(BIG)!.read).toHaveBeenCalledWith({ offset: 0, length: BIG_SIZE });
  });

  it('streams a malformed or multi-range request as the whole object', async () => {
    for (const range of ['bytes=0-1,5-6', 'bytes=10-5', 'bytes= 0-15']) {
      vi.mocked(handles.get(BIG)!.read).mockClear();
      const res = await request(app()).get(`/v1/objects/${BIG}`).set('Range', range).buffer(true);
      expect(res.status, range).toBe(200);
      expect(res.body.length, range).toBe(BIG_SIZE);
      expect(handles.get(BIG)!.read).toHaveBeenCalledWith();
    }
  });

  it('cuts the response off when Sia ends the stream short', async () => {
    const h = largeHandle(BIG, BIG_SIZE);
    h.read = vi.fn(() => largeHandle(BIG, BIG_SIZE - 100).read());
    handles.set(BIG, h);
    await expect(request(app()).get(`/v1/objects/${BIG}`).buffer(true)).rejects.toThrow();
  });
});

describe('errors', () => {
  it('answers 400 for an id that is not a sia object id, without a lookup', async () => {
    for (const id of ['nope', 'AA'.repeat(32), 'a'.repeat(63), `${'a'.repeat(64)}0`]) {
      const res = await request(app()).get(`/v1/objects/${id}`);
      expect(res.status, id).toBe(400);
    }
    expect(resolveObjectAccess).not.toHaveBeenCalled();
  });

  it('answers 404 for an object no asset claims, without asking the indexer', async () => {
    const res = await request(app()).get(`/v1/objects/${oid('ff')}`);
    expect(res.status).toBe(404);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(openObject).not.toHaveBeenCalled();
  });

  it('answers 404 for an object of an asset being deleted', async () => {
    access.set(THUMB, { kind: 'gone' });
    const res = await request(app()).get(`/v1/objects/${THUMB}`);
    expect(res.status).toBe(404);
    expect(openObject).not.toHaveBeenCalled();
  });

  it('answers 503 when the database cannot say who owns the object', async () => {
    vi.mocked(resolveObjectAccess).mockRejectedValueOnce(new Error('connection refused'));
    const res = await request(app()).get(`/v1/objects/${THUMB}`);
    expect(res.status).toBe(503);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('answers 404 when the indexer no longer has the object, 502 when it fails', async () => {
    access.set(THUMB, PUBLIC());
    handles.delete(THUMB);
    const missing = await request(app()).get(`/v1/objects/${THUMB}`);
    expect(missing.status).toBe(404);

    access.set(DATA, PUBLIC());
    vi.mocked(openObject).mockRejectedValueOnce(new Error('dial tcp: i/o timeout'));
    const down = await request(app()).get(`/v1/objects/${DATA}`).set('Range', 'bytes=0-1');
    expect(down.status).toBe(502);
    expect(down.headers['cache-control']).toBe('no-store');
  });
});

describe('bandwidth accounting', () => {
  async function bandwidth(): Promise<number> {
    const metric = await registry.getSingleMetric('sluby_bandwidth_bytes_total')?.get();
    return metric?.values[0]?.value ?? 0;
  }

  it('counts the bytes of a GET and none for HEAD or a 304', async () => {
    access.set(THUMB, PUBLIC());
    const before = await bandwidth();
    await request(app()).get(`/v1/objects/${THUMB}`);
    const afterGet = await bandwidth();
    expect(afterGet - before).toBe(JPEG.length);

    await request(app()).head(`/v1/objects/${THUMB}`);
    await request(app()).get(`/v1/objects/${THUMB}`).set('If-None-Match', `"${THUMB}"`);
    expect(await bandwidth()).toBe(afterGet);
  });
});
