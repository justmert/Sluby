/**
 * Plays through the real app over a real database: the gateway, the share
 * map route, the play counter and the queries are the shipped code. Only the
 * Sia indexer is a stand-in: objects come from memory and share urls are made
 * up, since neither decides what counts as a play.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import pino from 'pino';
import type { Express } from 'express';
import { hasTestDatabase, createTestDatabase, type TestDatabase } from './helpers/pg.js';
import type * as AssetQueries from '../db/queries/assets.js';
import type * as KeyQueries from '../db/queries/api-keys.js';
import type * as PlayQueries from '../db/queries/plays.js';
import type * as Recorder from '../delivery/play-recorder.js';
import type * as SignedUrl from '../delivery/signed-url.js';

const MASTER = 'a1'.repeat(32);
const VARIANT = 'b2'.repeat(32);
const DATA = 'c3'.repeat(32);
const PRIVATE_MASTER = 'd4'.repeat(32);
const BOB_MASTER = 'e5'.repeat(32);
const objects = new Map<string, Uint8Array>([
  [MASTER, new TextEncoder().encode(`#EXTM3U\nhttps://sluby.test/v1/objects/${VARIANT}\n`)],
  [PRIVATE_MASTER, new TextEncoder().encode(`#EXTM3U\nhttps://sluby.test/v1/objects/${VARIANT}\n`)],
  [BOB_MASTER, new TextEncoder().encode(`#EXTM3U\nhttps://sluby.test/v1/objects/${VARIANT}\n`)],
  [
    VARIANT,
    new TextEncoder().encode(`#EXTM3U\n#EXTINF:4,\nhttps://sluby.test/v1/objects/${DATA}\n`),
  ],
  [DATA, new Uint8Array(4096).fill(7)],
]);

vi.mock('../storage/sia-client.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../storage/sia-client.js')>()),
  openObject: async (id: string) => {
    const bytes = objects.get(id);
    if (!bytes) throw new Error(`no object ${id}`);
    return {
      id,
      size: bytes.length,
      read: (range?: { offset: number; length: number }) =>
        new ReadableStream({
          start(c) {
            const offset = range?.offset ?? 0;
            c.enqueue(bytes.subarray(offset, offset + (range?.length ?? bytes.length)));
            c.close();
          },
        }),
    };
  },
}));
vi.mock('../delivery/share-urls.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../delivery/share-urls.js')>()),
  createAssetShareUrls: async (_asset: string, master: string, expiresIn: number) => ({
    masterObjectId: master,
    shares: { [master]: `sia://indexer/objects/${master}/shared` },
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  }),
}));

const A = 'github:alice';
const B = 'github:bob';
const PLATFORM = `0x${'0'.repeat(64)}`;
const KEYS = {
  a: `sluby_${'a'.repeat(40)}`,
  b: `sluby_${'b'.repeat(40)}`,
  p: `sluby_${'e'.repeat(40)}`,
};

describe.skipIf(!hasTestDatabase)('plays (postgres, the real gateway)', () => {
  let tdb: TestDatabase;
  let app: Express;
  let assets: typeof AssetQueries;
  let keys: typeof KeyQueries;
  let plays: typeof PlayQueries;
  let recorder: typeof Recorder;
  let signed: typeof SignedUrl;
  let closeDatabase: () => Promise<void>;
  let pub: { id: string };
  let priv: { id: string };
  let bobs: { id: string };

  beforeAll(async () => {
    process.env.PUBLIC_URL = 'https://sluby.test';
    process.env.AUTH_DISABLED = 'false';
    tdb = await createTestDatabase();
    assets = await import('../db/queries/assets.js');
    keys = await import('../db/queries/api-keys.js');
    plays = await import('../db/queries/plays.js');
    recorder = await import('../delivery/play-recorder.js');
    signed = await import('../delivery/signed-url.js');
    ({ closeDatabase } = await import('../config/database.js'));
    const appModule = await import('../app.js');
    const fakeQueue = () => ({ add: async () => {}, getJobCounts: async () => ({}) });
    app = appModule.createApp({
      logger: pino({ level: 'silent' }),
      version: '9.9.9-test',
      startedAt: new Date(),
      queues: {
        transcode: fakeQueue(),
        uploadSegments: fakeQueue(),
        finalize: fakeQueue(),
        deletion: fakeQueue(),
      },
      pingRedis: async () => {},
      webhookDispatcher: { dispatch: async () => {}, enqueue: async () => {} },
      triggerReconciliation: async () => ({ enqueued: true }),
    }).app;
  }, 60_000);

  afterAll(async () => {
    await closeDatabase?.();
    await tdb?.drop();
  });

  async function readyAsset(owner: string, master: string, tier: 'public' | 'private') {
    const asset = await assets.createVideoAsset({
      title: `${owner} ${tier}`,
      creatorAddress: owner,
      status: 'ready',
      accessTier: tier,
      manifestObjectId: master,
    });
    // only the public video holds the shared playlist and data, so the
    // strictest claim on them stays public
    const children =
      master === MASTER
        ? [
            [VARIANT, 'variant_playlist'],
            [DATA, 'rendition_data'],
          ]
        : [];
    for (const [objectId, role] of [[master, 'master_manifest'], ...children]) {
      await tdb.sql`
        insert into artifacts (video_asset_id, object_id, role)
        values (${asset.id}, ${objectId}, ${role}::artifact_role)`;
    }
    return asset;
  }

  beforeEach(async () => {
    await tdb.truncate();
    await recorder.playCounter.flush();
    await keys.createApiKey({ name: 'a', scopes: ['read'], creatorAddress: A, rawKey: KEYS.a });
    await keys.createApiKey({ name: 'b', scopes: ['read'], creatorAddress: B, rawKey: KEYS.b });
    await keys.createApiKey({
      name: 'p',
      scopes: ['read'],
      creatorAddress: PLATFORM,
      rawKey: KEYS.p,
    });
    pub = await readyAsset(A, MASTER, 'public');
    priv = await readyAsset(A, PRIVATE_MASTER, 'private');
    bobs = await readyAsset(B, BOB_MASTER, 'public');
    // the gateway caches which asset claims an object, and every test makes
    // new assets for the same object ids
    const access = await import('../delivery/access-control.js');
    for (const id of objects.keys()) access.invalidateObjectAccessTier(id);
  });

  const viewer = (ua: string) => ({ 'User-Agent': ua });

  async function playCount(id: string, who: keyof typeof KEYS = 'a') {
    await recorder.playCounter.flush();
    const res = await request(app)
      .get(`/api/v1/assets/${id}`)
      .set('Authorization', `Bearer ${KEYS[who]}`);
    expect(res.status).toBe(200);
    return res.body as { play_count: number; last_played_at: string | null };
  }

  it('counts a gateway play once: the master, not its playlists, segments, HEAD or 304', async () => {
    const master = await request(app)
      .get(`/v1/stream/${pub.id}/master.m3u8`)
      .set(viewer('gateway viewer'));
    expect(master.status).toBe(200);
    // what hls.js does next for the same load
    expect(
      (await request(app).get(`/v1/objects/${VARIANT}`).set(viewer('gateway viewer'))).status,
    ).toBe(200);
    const range = await request(app)
      .get(`/v1/objects/${DATA}`)
      .set({ ...viewer('gateway viewer'), Range: 'bytes=0-1023' });
    expect(range.status).toBe(206);
    // a HEAD and a revalidation by other viewers are no plays either
    expect(
      (await request(app).head(`/v1/stream/${pub.id}/master.m3u8`).set(viewer('header'))).status,
    ).toBe(200);
    const revalidated = await request(app)
      .get(`/v1/stream/${pub.id}/master.m3u8`)
      .set({ ...viewer('revalidator'), 'If-None-Match': master.headers.etag });
    expect(revalidated.status).toBe(304);

    const after = await playCount(pub.id);
    expect(after.play_count).toBe(1);
    expect(Date.parse(after.last_played_at!)).toBeGreaterThan(Date.now() - 60_000);
  });

  it('counts a direct-from-Sia play once: the share map, not its refresh', async () => {
    const share = await request(app).get(`/v1/share/${pub.id}`).set(viewer('sia viewer'));
    expect(share.status).toBe(200);
    // the sdk refreshes the map before it lapses during a long watch
    const renew = await request(app).get(`/v1/share/${pub.id}?renew=1`).set(viewer('sia viewer'));
    expect(renew.status).toBe(200);
    expect((await playCount(pub.id)).play_count).toBe(1);
  });

  it('counts a gateway play and a direct play by two viewers as two', async () => {
    await request(app).get(`/v1/stream/${pub.id}/master.m3u8`).set(viewer('one'));
    await request(app).get(`/v1/share/${pub.id}`).set(viewer('two'));
    expect((await playCount(pub.id)).play_count).toBe(2);
  });

  it('counts one viewer reloading within half an hour once', async () => {
    await request(app).get(`/v1/stream/${pub.id}/master.m3u8`).set(viewer('reloader'));
    await request(app).get(`/v1/stream/${pub.id}/master.m3u8`).set(viewer('reloader'));
    await request(app).get(`/v1/share/${pub.id}`).set(viewer('reloader'));
    expect((await playCount(pub.id)).play_count).toBe(1);
  });

  it('does not count previews in the studio of this server', async () => {
    const studio = { ...viewer('studio'), Referer: `https://sluby.test/studio/videos/${pub.id}` };
    await request(app)
      .get(`/v1/stream/${pub.id}/master.m3u8`)
      .set(studio)
      .set('Host', 'sluby.test');
    await request(app).get(`/v1/share/${pub.id}`).set(studio).set('Host', 'sluby.test');
    expect((await playCount(pub.id)).play_count).toBe(0);
    // an embed on another site sends its own page as the referer
    await request(app)
      .get(`/v1/share/${pub.id}`)
      .set({ ...viewer('embed'), Referer: 'https://blog.example/studio/post' })
      .set('Host', 'sluby.test');
    expect((await playCount(pub.id)).play_count).toBe(1);
  });

  it('counts a signed playback of a private video at its master object, and no refusal', async () => {
    const refused = await request(app)
      .get(`/v1/objects/${PRIVATE_MASTER}?type=manifest`)
      .set(viewer('x'));
    expect(refused.status).toBe(403);
    const exp = Math.floor(Date.now() / 1000) + 600;
    const query = signed.buildSignedObjectQuery(
      PRIVATE_MASTER,
      exp,
      0,
      (await import('../config/env.js')).env.SESSION_SECRET,
    );
    const ok = await request(app)
      .get(`/v1/objects/${PRIVATE_MASTER}?type=manifest&${query}`)
      .set(viewer('x'));
    expect(ok.status).toBe(200);
    expect((await playCount(priv.id)).play_count).toBe(1);
  });

  it('keeps plays and usage to the account, zero-filled, and every account for the platform', async () => {
    await request(app).get(`/v1/stream/${pub.id}/master.m3u8`).set(viewer('v1'));
    await request(app).get(`/v1/stream/${pub.id}/master.m3u8`).set(viewer('v2'));
    await request(app).get(`/v1/share/${bobs.id}`).set(viewer('v1'));
    await recorder.playCounter.flush();

    const usage = async (who: keyof typeof KEYS, days?: number) =>
      (
        await request(app)
          .get(`/api/v1/stats/usage${days ? `?days=${days}` : ''}`)
          .set('Authorization', `Bearer ${KEYS[who]}`)
      ).body as { days: Array<{ date: string; plays: number }>; total: number };
    const alice = await usage('a', 7);
    expect(alice.days).toHaveLength(7);
    expect(alice.days[6]).toEqual({ date: new Date().toISOString().slice(0, 10), plays: 2 });
    expect(alice.days.slice(0, 6).every((d) => d.plays === 0)).toBe(true);
    expect(alice.total).toBe(2);
    expect((await usage('b')).total).toBe(1);
    expect((await usage('p')).total).toBe(3);

    // another account's video is a 404, whatever its plays
    const foreign = await request(app)
      .get(`/api/v1/assets/${bobs.id}`)
      .set('Authorization', `Bearer ${KEYS.a}`);
    expect(foreign.status).toBe(404);
    expect((await playCount(bobs.id, 'b')).play_count).toBe(1);
  });

  it('writes plays without touching the version, and skips videos deleted meanwhile', async () => {
    const before = (await tdb.sql`select updated_at from video_assets where id = ${pub.id}`)[0];
    const day = new Date().toISOString().slice(0, 10);
    const gone = await assets.createVideoAsset({ title: 'gone', creatorAddress: A });
    await tdb.sql`delete from video_assets where id = ${gone.id}`;
    await plays.writePlays([
      { assetId: pub.id, day, plays: 3, lastPlayedAt: new Date('2026-01-01T00:00:00Z') },
      { assetId: gone.id, day, plays: 5, lastPlayedAt: new Date() },
    ]);
    await plays.writePlays([
      { assetId: pub.id, day, plays: 2, lastPlayedAt: new Date('2025-01-01T00:00:00Z') },
    ]);
    const [row] =
      await tdb.sql`select updated_at, last_played_at from video_assets where id = ${pub.id}`;
    expect((row.updated_at as Date).getTime()).toBe((before.updated_at as Date).getTime());
    // the newest play time wins, whatever order batches arrive in
    expect((row.last_played_at as Date).toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect((await plays.getPlayCounts([pub.id, gone.id])).get(pub.id)).toBe(5);
    const [{ n }] = await tdb.sql`select count(*)::int as n from asset_plays_daily`;
    expect(n).toBe(1);
  });
});
