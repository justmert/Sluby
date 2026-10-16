/**
 * The real express app (app.ts) over a real Postgres database, with two
 * tenants, a platform key and narrower keys. Queues, the webhook dispatcher
 * and the reconcile trigger are in-memory stand-ins; everything else (routes,
 * adapters, queries, tus) is the shipped code. Every response is checked
 * against the OpenAPI document, and the last test fails if an operation in
 * the document was never exercised.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import pino from 'pino';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import { hasTestDatabase, createTestDatabase, type TestDatabase } from './helpers/pg.js';
import {
  createSpecChecker,
  documentedOperations,
  type ResponseLike,
} from './helpers/openapi-validate.js';
import type * as AppModule from '../app.js';
import type * as AssetQueries from '../db/queries/assets.js';
import type * as KeyQueries from '../db/queries/api-keys.js';

const A = 'github:alice';
const B = 'github:bob';
const PLATFORM = `0x${'0'.repeat(64)}`;
const PUBLIC_URL = 'https://sluby.test';

type Who = 'a' | 'b' | 'aUpload' | 'aRead' | 'platform' | 'none';

const RAW_KEYS: Record<Exclude<Who, 'none'>, string> = {
  a: `sluby_${'a'.repeat(40)}`,
  b: `sluby_${'b'.repeat(40)}`,
  aUpload: `sluby_${'c'.repeat(40)}`,
  aRead: `sluby_${'d'.repeat(40)}`,
  platform: `sluby_${'e'.repeat(40)}`,
};

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const tusMetadata = (fields: Record<string, string>) =>
  Object.entries(fields)
    .map(([k, v]) => `${k} ${b64(v)}`)
    .join(',');

describe.skipIf(!hasTestDatabase)('api contract (postgres, two tenants)', () => {
  let tdb: TestDatabase;
  let app: Express;
  let appModule: typeof AppModule;
  let built: ReturnType<typeof AppModule.createApp>;
  let assets: typeof AssetQueries;
  let keys: typeof KeyQueries;
  let closeDatabase: () => Promise<void>;
  let uploadDir: string;
  let outputDir: string;
  const spec = createSpecChecker();

  const jobs: Array<{ queue: string; name: string; data: unknown; jobId?: string }> = [];
  const events: Array<{ event: string; data: Record<string, unknown>; owner: string }> = [];
  let reconcileTriggers = 0;

  const fakeQueue = (queue: string) => ({
    add: async (name: string, data: unknown, opts?: { jobId?: string }) => {
      jobs.push({ queue, name, data, jobId: opts?.jobId });
    },
    getJobCounts: async () => ({ waiting: 0, active: 0, delayed: 0 }),
  });

  beforeAll(async () => {
    uploadDir = mkdtempSync(path.join(os.tmpdir(), 'sluby-contract-up-'));
    outputDir = mkdtempSync(path.join(os.tmpdir(), 'sluby-contract-out-'));
    process.env.UPLOAD_DIR = uploadDir;
    process.env.TRANSCODE_OUTPUT_DIR = outputDir;
    process.env.PUBLIC_URL = PUBLIC_URL;
    process.env.AUTH_DISABLED = 'false';
    process.env.GITHUB_ALLOWED_USERS = '';
    process.env.GITHUB_CLIENT_ID = 'contract-test-client';
    process.env.GITHUB_CLIENT_SECRET = 'contract-test-secret';
    // the status probes must fail fast instead of waiting on a real indexer
    process.env.SIA_INDEXER_URL = 'http://127.0.0.1:9';

    tdb = await createTestDatabase();
    appModule = await import('../app.js');
    assets = await import('../db/queries/assets.js');
    keys = await import('../db/queries/api-keys.js');
    ({ closeDatabase } = await import('../config/database.js'));

    built = appModule.createApp({
      logger: pino({ level: 'silent' }),
      version: '9.9.9-test',
      startedAt: new Date(Date.now() - 60_000),
      queues: {
        transcode: fakeQueue('transcode'),
        uploadSegments: fakeQueue('upload-segments'),
        finalize: fakeQueue('finalize'),
        deletion: fakeQueue('deletion'),
      },
      pingRedis: async () => {},
      webhookDispatcher: {
        dispatch: async (event, data, owner) => {
          events.push({ event, data, owner });
        },
      },
      triggerReconciliation: async () => {
        reconcileTriggers++;
        return { enqueued: true };
      },
    });
    app = built.app;
  }, 60_000);

  afterAll(async () => {
    await closeDatabase?.();
    await tdb?.drop();
    rmSync(uploadDir, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  });

  let assetA: { id: string };
  let assetAFailed: { id: string };
  let assetADeleted: { id: string };
  let assetB: { id: string };

  beforeEach(async () => {
    await tdb.truncate();
    jobs.length = 0;
    events.length = 0;
    reconcileTriggers = 0;
    mkdirSync(uploadDir, { recursive: true });

    const all = ['upload', 'read', 'manage'];
    await keys.createApiKey({ name: 'a', scopes: all, creatorAddress: A, rawKey: RAW_KEYS.a });
    await keys.createApiKey({ name: 'b', scopes: all, creatorAddress: B, rawKey: RAW_KEYS.b });
    await keys.createApiKey({
      name: 'a upload',
      scopes: ['upload'],
      creatorAddress: A,
      rawKey: RAW_KEYS.aUpload,
    });
    await keys.createApiKey({
      name: 'a read',
      scopes: ['read'],
      creatorAddress: A,
      rawKey: RAW_KEYS.aRead,
    });
    await keys.createApiKey({
      name: 'platform',
      scopes: all,
      creatorAddress: PLATFORM,
      rawKey: RAW_KEYS.platform,
    });

    assetA = await assets.createVideoAsset({
      title: 'alice ready',
      creatorAddress: A,
      status: 'ready',
      manifestObjectId: 'a1'.repeat(32),
      thumbnailObjectIds: ['a2'.repeat(32)],
      durationMs: 12_000,
      resolution: '1920x1080',
    });
    assetAFailed = await assets.createVideoAsset({
      title: 'alice failed',
      creatorAddress: A,
      status: 'failed',
    });
    assetADeleted = await assets.createVideoAsset({
      title: 'alice deleted',
      creatorAddress: A,
      status: 'ready',
      manifestObjectId: 'a3'.repeat(32),
    });
    await assets.softDeleteVideoAsset(assetADeleted.id, A);
    assetB = await assets.createVideoAsset({
      title: 'bob ready',
      creatorAddress: B,
      status: 'ready',
      manifestObjectId: 'b1'.repeat(32),
    });
  });

  function call(method: string, url: string, who: Who, body?: unknown) {
    let req = request(app)[method.toLowerCase() as 'get'](url);
    if (who !== 'none') req = req.set('Authorization', `Bearer ${RAW_KEYS[who]}`);
    if (body !== undefined) req = req.send(body as object);
    return req;
  }

  function check(method: string, template: string, res: ResponseLike) {
    spec.check(method, template, res);
  }

  async function assetRow(id: string) {
    const [row] = await tdb.sql<{ title: string; description: string; deleted_at: Date | null }[]>`
      select title, description, deleted_at from video_assets where id = ${id}
    `;
    return row;
  }

  // ── service and docs ──────────────────────────────────────────────────

  describe('service routes', () => {
    it('serves the document, the docs page and health without a key', async () => {
      const doc = await call('GET', '/api/v1/openapi.json', 'none');
      check('GET', '/api/v1/openapi.json', doc);
      expect(doc.status).toBe(200);
      const docs = await call('GET', '/api/v1/docs', 'none');
      check('GET', '/api/v1/docs', docs);
      expect(docs.status).toBe(200);
      const health = await call('GET', '/health', 'none');
      check('GET', '/health', health);
      expect(health.status).toBe(200);
      const prom = await call('GET', '/metrics', 'none');
      check('GET', '/metrics', prom);
      expect(prom.status).toBe(200);
    });

    it('answers 404, not 401, for an unknown route under /api/v1 without a key', async () => {
      const res = await call('GET', '/api/v1/no-such-thing', 'none');
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Route GET /api/v1/no-such-thing not found' });
      const wrongMethod = await call('PUT', `/api/v1/assets/${assetA.id}`, 'none');
      expect(wrongMethod.status).toBe(404);
    });

    it('still answers 401 for a known route without a key, and 403 for a missing scope', async () => {
      const res = await call('GET', '/api/v1/assets', 'none');
      check('GET', '/api/v1/assets', res);
      expect(res.status).toBe(401);
      const forbidden = await call('PATCH', `/api/v1/assets/${assetA.id}`, 'aRead', { title: 'x' });
      check('PATCH', '/api/v1/assets/{id}', forbidden);
      expect(forbidden.status).toBe(403);
    });

    it('documents the 429 of the rate limiter', async () => {
      await keys.createApiKey({
        name: 'slow',
        scopes: ['read'],
        creatorAddress: A,
        rawKey: `sluby_${'f'.repeat(40)}`,
        rateLimit: 1,
      });
      const send = () =>
        request(app)
          .get('/api/v1/stats')
          .set('Authorization', `Bearer sluby_${'f'.repeat(40)}`);
      expect((await send()).status).toBe(200);
      const res = await send();
      check('GET', '/api/v1/stats', res);
      expect(res.status).toBe(429);
      expect(res.body.retry_after).toBeGreaterThan(0);
      expect(res.headers['retry-after']).toBeDefined();
    });
  });

  // ── assets ────────────────────────────────────────────────────────────

  describe('assets', () => {
    it('lists only the caller’s live assets', async () => {
      const res = await call('GET', '/api/v1/assets', 'a');
      check('GET', '/api/v1/assets', res);
      expect(res.status).toBe(200);
      const ids = res.body.data.map((x: { id: string }) => x.id).sort();
      expect(ids).toEqual([assetA.id, assetAFailed.id].sort());
      expect(res.body.total).toBe(2);
    });

    it('lists every tenant’s assets for the platform key', async () => {
      const res = await call('GET', '/api/v1/assets', 'platform');
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(3);
    });

    it('scopes a key with an empty address to nothing, not to everything', async () => {
      const raw = `sluby_${'9'.repeat(40)}`;
      await keys.createApiKey({
        name: 'blank',
        scopes: ['read', 'manage'],
        creatorAddress: '',
        rawKey: raw,
      });
      const as = (method: 'get' | 'patch', url: string) =>
        request(app)[method](url).set('Authorization', `Bearer ${raw}`);
      expect((await as('get', '/api/v1/assets')).body.total).toBe(0);
      expect((await as('get', `/api/v1/assets/${assetA.id}`)).status).toBe(404);
      expect((await as('get', '/api/v1/stats')).body.total).toBe(0);
      const listed = await as('get', '/api/v1/keys');
      expect(listed.body.data.map((k: { name: string }) => k.name)).toEqual(['blank']);
    });

    it('reports an unknown duration and resolution as null', async () => {
      const res = await call('GET', `/api/v1/assets/${assetAFailed.id}`, 'a');
      check('GET', '/api/v1/assets/{id}', res);
      expect(res.body.duration_ms).toBeNull();
      expect(res.body.resolution).toBeNull();
      const ready = await call('GET', `/api/v1/assets/${assetA.id}`, 'a');
      expect(ready.body.duration_ms).toBe(12_000);
      expect(ready.body.resolution).toBe('1920x1080');
    });

    it('rejects malformed list parameters with 400', async () => {
      for (const query of [
        'search=a&search=b',
        'status=ready&status=failed',
        'limit=0',
        'limit=-5',
        'limit=101',
        'limit=2.5',
        'limit=abc',
        `page=1${'0'.repeat(400)}`,
        'page=0',
        'page=abc',
        'sort=nope',
        'order=up',
        `search=${'x'.repeat(201)}`,
      ]) {
        const res = await call('GET', `/api/v1/assets?${query}`, 'a');
        check('GET', '/api/v1/assets', res);
        expect(res.status, query).toBe(400);
      }
    });

    it('answers 400 for a bad cursor instead of restarting the list', async () => {
      const res = await call('GET', '/api/v1/assets?cursor=garbage', 'a');
      check('GET', '/api/v1/assets', res);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/cursor/i);
    });

    it('refuses a cursor and a page together', async () => {
      const first = await call('GET', '/api/v1/assets?limit=1', 'a');
      expect(first.body.next_cursor).toBeTruthy();
      const res = await call(
        'GET',
        `/api/v1/assets?limit=1&page=2&cursor=${first.body.next_cursor}`,
        'a',
      );
      check('GET', '/api/v1/assets', res);
      expect(res.status).toBe(400);
    });

    it('pages forward with a valid cursor, and reports page as null on cursor pages', async () => {
      const first = await call('GET', '/api/v1/assets?limit=1', 'a');
      const second = await call(
        'GET',
        `/api/v1/assets?limit=1&cursor=${first.body.next_cursor}`,
        'a',
      );
      check('GET', '/api/v1/assets', second);
      expect(second.status).toBe(200);
      expect(second.body.page).toBeNull();
      expect(second.body.data[0].id).not.toBe(first.body.data[0].id);
      expect(second.body.has_more).toBe(false);
    });

    it('hides another tenant’s and soft-deleted assets behind 404 on every by-id route', async () => {
      for (const id of [assetB.id, assetADeleted.id]) {
        const routes: Array<[string, string, string, unknown?]> = [
          ['GET', `/api/v1/assets/${id}`, '/api/v1/assets/{id}'],
          ['PATCH', `/api/v1/assets/${id}`, '/api/v1/assets/{id}', { title: 'taken' }],
          ['DELETE', `/api/v1/assets/${id}`, '/api/v1/assets/{id}'],
          ['GET', `/api/v1/assets/${id}/processing`, '/api/v1/assets/{id}/processing'],
          ['GET', `/api/v1/assets/${id}/renditions`, '/api/v1/assets/{id}/renditions'],
          ['POST', `/api/v1/assets/${id}/retry`, '/api/v1/assets/{id}/retry'],
          ['GET', `/api/v1/assets/${id}/sia`, '/api/v1/assets/{id}/sia'],
          ['GET', `/api/v1/assets/${id}/playback-ids`, '/api/v1/assets/{id}/playback-ids'],
          [
            'POST',
            `/api/v1/assets/${id}/playback-ids`,
            '/api/v1/assets/{id}/playback-ids',
            { policy: 'public' },
          ],
          ['GET', `/api/v1/playback/${id}`, '/api/v1/playback/{id}'],
          ['GET', `/api/v1/playback/${id}/signed`, '/api/v1/playback/{id}/signed'],
          ['GET', `/api/v1/playback/${id}/share`, '/api/v1/playback/{id}/share'],
        ];
        for (const [method, url, template, body] of routes) {
          const res = await call(method, url, 'a', body);
          check(method, template, res);
          expect(res.status, `${method} ${url}`).toBe(404);
        }
      }
      // the rows themselves are untouched
      expect((await assetRow(assetB.id)).title).toBe('bob ready');
      expect((await assetRow(assetADeleted.id)).title).toBe('alice deleted');
    });

    it('answers 400 for a malformed asset id', async () => {
      const res = await call('GET', '/api/v1/assets/not-a-uuid', 'a');
      check('GET', '/api/v1/assets/{id}', res);
      expect(res.status).toBe(400);
    });

    it('validates the PATCH body and stores nothing on a bad one', async () => {
      const bad: unknown[] = [
        { title: { x: 1 } },
        { title: ['a', 'b'] },
        { title: 42 },
        { title: '' },
        { title: '   ' },
        { title: null },
        { title: 'a\u0000b' },
        { title: 'a\u0007b' },
        { title: 'x'.repeat(201) },
        { description: null },
        { description: 'a\u0000b' },
        { description: 'x'.repeat(5001) },
        { access_tier: 'Private' },
        { access_tier: null },
        { colour: 'red' },
      ];
      for (const body of bad) {
        const res = await call('PATCH', `/api/v1/assets/${assetA.id}`, 'a', body);
        check('PATCH', '/api/v1/assets/{id}', res);
        expect(res.status, JSON.stringify(body)).toBe(400);
      }
      expect((await assetRow(assetA.id)).title).toBe('alice ready');
    });

    it('updates title, description and tier, trimming the title', async () => {
      const res = await call('PATCH', `/api/v1/assets/${assetA.id}`, 'a', {
        title: '  renamed  ',
        description: 'line one\nline two',
        access_tier: 'private',
      });
      check('PATCH', '/api/v1/assets/{id}', res);
      expect(res.status).toBe(200);
      expect(res.body.title).toBe('renamed');
      expect(res.body.access_tier).toBe('private');
      const row = await assetRow(assetA.id);
      expect(row.title).toBe('renamed');
      expect(row.description).toBe('line one\nline two');
    });

    it('deletes once, then answers 404', async () => {
      const res = await call('DELETE', `/api/v1/assets/${assetA.id}`, 'a');
      check('DELETE', '/api/v1/assets/{id}', res);
      expect(res.status).toBe(200);
      expect(jobs).toContainEqual(expect.objectContaining({ queue: 'deletion' }));
      const again = await call('DELETE', `/api/v1/assets/${assetA.id}`, 'a');
      expect(again.status).toBe(404);
    });

    it('documents the processing, renditions and retry answers for an own asset', async () => {
      const processing = await call('GET', `/api/v1/assets/${assetA.id}/processing`, 'a');
      check('GET', '/api/v1/assets/{id}/processing', processing);
      expect(processing.status).toBe(404);

      const renditions = await call('GET', `/api/v1/assets/${assetA.id}/renditions`, 'a');
      check('GET', '/api/v1/assets/{id}/renditions', renditions);
      expect(renditions.status).toBe(200);

      const notFailed = await call('POST', `/api/v1/assets/${assetA.id}/retry`, 'a');
      check('POST', '/api/v1/assets/{id}/retry', notFailed);
      expect(notFailed.status).toBe(400);

      // failed, with no transcode output and no source on disk
      const gone = await call('POST', `/api/v1/assets/${assetAFailed.id}/retry`, 'a');
      check('POST', '/api/v1/assets/{id}/retry', gone);
      expect(gone.status).toBe(410);
    });

    it('retries a failed asset whose transcode output is on disk', async () => {
      const dir = path.join(outputDir, assetAFailed.id);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, 'master.m3u8'), '#EXTM3U\n');
      const res = await call('POST', `/api/v1/assets/${assetAFailed.id}/retry`, 'a');
      check('POST', '/api/v1/assets/{id}/retry', res);
      expect(res.status).toBe(200);
      expect(res.body.stage).toBe('upload-segments');
    });

    it('answers the storage breakdown even when the indexer is unreachable', async () => {
      const res = await call('GET', `/api/v1/assets/${assetA.id}/sia`, 'a');
      check('GET', '/api/v1/assets/{id}/sia', res);
      expect(res.status).toBe(200);
    });
  });

  // ── playback ──────────────────────────────────────────────────────────

  describe('playback', () => {
    it('answers playback info, signed urls and 409 for an asset that is not ready', async () => {
      const info = await call('GET', `/api/v1/playback/${assetA.id}`, 'a');
      check('GET', '/api/v1/playback/{id}', info);
      expect(info.status).toBe(200);

      const signed = await call('GET', `/api/v1/playback/${assetA.id}/signed`, 'a');
      check('GET', '/api/v1/playback/{id}/signed', signed);
      expect(signed.status).toBe(200);
      expect(signed.body.signed_url.startsWith(`${PUBLIC_URL}/v1/objects/`)).toBe(true);

      const notReady = await call('GET', `/api/v1/playback/${assetAFailed.id}`, 'a');
      check('GET', '/api/v1/playback/{id}', notReady);
      expect(notReady.status).toBe(409);

      // minting needs the indexer, which this test has none of
      const share = await call('GET', `/api/v1/playback/${assetA.id}/share`, 'a');
      check('GET', '/api/v1/playback/{id}/share', share);
      expect(share.status).toBe(502);
    });

    it('creates, lists and deletes playback ids, scoped to the owner', async () => {
      const created = await call('POST', `/api/v1/assets/${assetA.id}/playback-ids`, 'a', {
        policy: 'signed',
        name: 'embed',
      });
      check('POST', '/api/v1/assets/{id}/playback-ids', created);
      expect(created.status).toBe(201);

      const bad = await call('POST', `/api/v1/assets/${assetA.id}/playback-ids`, 'a', {
        policy: 'open',
      });
      check('POST', '/api/v1/assets/{id}/playback-ids', bad);
      expect(bad.status).toBe(400);

      const list = await call('GET', `/api/v1/assets/${assetA.id}/playback-ids`, 'a');
      check('GET', '/api/v1/assets/{id}/playback-ids', list);
      expect(list.body.data).toHaveLength(1);

      const pb = created.body.playback_id;
      const byB = await call('DELETE', `/api/v1/playback-ids/${pb}`, 'b');
      check('DELETE', '/api/v1/playback-ids/{playbackId}', byB);
      expect(byB.status).toBe(404);
      const byA = await call('DELETE', `/api/v1/playback-ids/${pb}`, 'a');
      check('DELETE', '/api/v1/playback-ids/{playbackId}', byA);
      expect(byA.status).toBe(200);
    });
  });

  // ── keys ──────────────────────────────────────────────────────────────

  describe('keys', () => {
    it('creates a key and answers with the same shape GET lists, plus the secret', async () => {
      const res = await call('POST', '/api/v1/keys', 'a', {
        name: 'ci',
        scopes: ['read', 'read', 'upload'],
      });
      check('POST', '/api/v1/keys', res);
      expect(res.status).toBe(201);
      expect(res.body.scopes).toEqual(['read', 'upload']);
      expect(res.body.key).toMatch(/^sluby_/);

      const list = await call('GET', '/api/v1/keys', 'a');
      check('GET', '/api/v1/keys', list);
      const listed = list.body.data.find((k: { id: string }) => k.id === res.body.id);
      const { key: _secret, ...created } = res.body;
      expect(created).toEqual(listed);
    });

    it('rejects names, scopes and rate limits the database cannot hold', async () => {
      const bad: unknown[] = [
        { name: 'a\u0000b' },
        { name: 'tab\tname' },
        { name: 'x'.repeat(101) },
        { name: '   ' },
        { name: 42 },
        { name: 'ok', scopes: [] },
        { name: 'ok', scopes: 'read' },
        { name: 'ok', scopes: ['admin'] },
        { name: 'ok', rate_limit: 2 ** 31 },
        { name: 'ok', rate_limit: 0 },
        { name: 'ok', rate_limit: 1.5 },
        { name: 'ok', rate_limit: 100_001 },
        { name: 'ok', colour: 'red' },
      ];
      for (const body of bad) {
        const res = await call('POST', '/api/v1/keys', 'a', body);
        check('POST', '/api/v1/keys', res);
        expect(res.status, JSON.stringify(body)).toBe(400);
      }
    });

    it('lists every key of an account with 55 keys, and pages them', async () => {
      for (let i = 0; i < 55; i++) {
        await keys.createApiKey({ name: `k${i}`, scopes: ['read'], creatorAddress: A });
      }
      const all = await call('GET', '/api/v1/keys', 'a');
      check('GET', '/api/v1/keys', all);
      // 55 plus the three fixture keys of alice
      expect(all.body.data).toHaveLength(58);
      expect(all.body.has_more).toBe(false);

      const seen = new Set<string>();
      let cursor: string | null = null;
      do {
        const page: ResponseLike & {
          body: { data: { id: string }[]; next_cursor: string | null };
        } = await call('GET', `/api/v1/keys?limit=20${cursor ? `&cursor=${cursor}` : ''}`, 'a');
        check('GET', '/api/v1/keys', page);
        for (const k of page.body.data) seen.add(k.id);
        cursor = page.body.next_cursor;
      } while (cursor);
      expect(seen.size).toBe(58);

      const badCursor = await call('GET', '/api/v1/keys?cursor=garbage', 'a');
      check('GET', '/api/v1/keys', badCursor);
      expect(badCursor.status).toBe(400);
      const badLimit = await call('GET', '/api/v1/keys?limit=0', 'a');
      expect(badLimit.status).toBe(400);
    });

    it('lists, rotates and deletes across tenants only for the platform key', async () => {
      const bKeys = await call('GET', '/api/v1/keys', 'b');
      const bKeyId = bKeys.body.data[0].id;

      const listA = await call('GET', '/api/v1/keys', 'a');
      expect(listA.body.data.map((k: { id: string }) => k.id)).not.toContain(bKeyId);
      const platformList = await call('GET', '/api/v1/keys', 'platform');
      expect(platformList.body.data.map((k: { id: string }) => k.id)).toContain(bKeyId);

      const rotate = await call('POST', `/api/v1/keys/${bKeyId}/rotate`, 'a', {});
      check('POST', '/api/v1/keys/{id}/rotate', rotate);
      expect(rotate.status).toBe(404);
      const del = await call('DELETE', `/api/v1/keys/${bKeyId}`, 'a');
      check('DELETE', '/api/v1/keys/{id}', del);
      expect(del.status).toBe(404);

      const rotated = await call('POST', `/api/v1/keys/${bKeyId}/rotate`, 'platform', {
        grace_period_seconds: 60,
      });
      check('POST', '/api/v1/keys/{id}/rotate', rotated);
      expect(rotated.status).toBe(201);
      const twice = await call('POST', `/api/v1/keys/${bKeyId}/rotate`, 'platform', {});
      check('POST', '/api/v1/keys/{id}/rotate', twice);
      expect(twice.status).toBe(409);
      const badGrace = await call('POST', `/api/v1/keys/${bKeyId}/rotate`, 'platform', {
        grace_period_seconds: -1,
      });
      check('POST', '/api/v1/keys/{id}/rotate', badGrace);
      expect(badGrace.status).toBe(400);

      const deleted = await call('DELETE', `/api/v1/keys/${rotated.body.id}`, 'platform');
      check('DELETE', '/api/v1/keys/{id}', deleted);
      expect(deleted.status).toBe(200);
    });
  });

  // ── webhooks (responses only; their rules belong to the webhook code) ──

  describe('webhooks', () => {
    it('creates, lists and deletes an endpoint with documented responses', async () => {
      const created = await call('POST', '/api/v1/webhooks', 'a', {
        url: 'https://hooks.example.com/sluby',
        events: ['asset.ready'],
      });
      check('POST', '/api/v1/webhooks', created);
      expect(created.status).toBe(201);
      const bad = await call('POST', '/api/v1/webhooks', 'a', { url: 'nope', events: [] });
      check('POST', '/api/v1/webhooks', bad);
      expect(bad.status).toBe(400);
      const list = await call('GET', '/api/v1/webhooks', 'a');
      check('GET', '/api/v1/webhooks', list);
      expect(list.body.data).toHaveLength(1);
      const byB = await call('DELETE', `/api/v1/webhooks/${created.body.id}`, 'b');
      check('DELETE', '/api/v1/webhooks/{id}', byB);
      expect(byB.status).toBe(404);
      const byA = await call('DELETE', `/api/v1/webhooks/${created.body.id}`, 'a');
      check('DELETE', '/api/v1/webhooks/{id}', byA);
      expect(byA.status).toBe(200);
    });
  });

  // ── uploads (tus and the REST status and cancel) ──────────────────────

  describe('uploads', () => {
    function tusCreate(who: Who, metadata: Record<string, string>, length: number | string = 10) {
      let req = request(app)
        .post('/api/v1/uploads')
        .set('Tus-Resumable', '1.0.0')
        .set('Upload-Length', String(length))
        .set('Upload-Metadata', tusMetadata(metadata));
      if (who !== 'none') req = req.set('Authorization', `Bearer ${RAW_KEYS[who]}`);
      return req;
    }

    function tusPatch(who: Exclude<Who, 'none'>, id: string, offset: number, bytes: Buffer) {
      return request(app)
        .patch(`/api/v1/uploads/${id}`)
        .set('Tus-Resumable', '1.0.0')
        .set('Upload-Offset', String(offset))
        .set('Content-Type', 'application/offset+octet-stream')
        .set('Authorization', `Bearer ${RAW_KEYS[who]}`)
        .send(bytes);
    }

    function tusDelete(who: Exclude<Who, 'none'>, id: string) {
      return request(app)
        .delete(`/api/v1/uploads/${id}`)
        .set('Tus-Resumable', '1.0.0')
        .set('Authorization', `Bearer ${RAW_KEYS[who]}`);
    }

    const video = { filename: 'clip.mp4', filetype: 'video/mp4', title: 'clip' };

    async function countAssets(owner: string) {
      const [{ n }] = await tdb.sql<{ n: number }[]>`
        select count(*)::int as n from video_assets where creator_address = ${owner}
      `;
      return n;
    }

    it('keys the REST status on the id in the tus Location, built from PUBLIC_URL', async () => {
      const created = await tusCreate('a', video)
        .set('X-Forwarded-Host', 'evil.example')
        .set('X-Forwarded-Proto', 'http');
      check('POST', '/api/v1/uploads', created);
      expect(created.status).toBe(201);
      const location = created.headers.location as string;
      expect(location).toMatch(
        new RegExp(
          `^${PUBLIC_URL}/api/v1/uploads/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
        ),
      );
      const id = location.split('/').pop()!;

      const status = await call('GET', `/api/v1/uploads/${id}`, 'a');
      check('GET', '/api/v1/uploads/{id}', status);
      expect(status.status).toBe(200);
      expect(status.body.id).toBe(id);
      expect(status.body.status).toBe('uploading');
      const assetId = status.body.video_asset_id;
      expect((await call('GET', `/api/v1/assets/${assetId}`, 'a')).status).toBe(200);

      // the stored upload url is the real one
      const [row] = await tdb.sql<{ upload_url: string }[]>`
        select upload_url from upload_sessions where id = ${id}
      `;
      expect(row.upload_url).toBe(location);

      const otherTenant = await call('GET', `/api/v1/uploads/${id}`, 'b');
      check('GET', '/api/v1/uploads/{id}', otherTenant);
      expect(otherTenant.status).toBe(404);

      const head = await request(app)
        .head(`/api/v1/uploads/${id}`)
        .set('Tus-Resumable', '1.0.0')
        .set('Authorization', `Bearer ${RAW_KEYS.a}`);
      check('HEAD', '/api/v1/uploads/{id}', head);
      expect(head.status).toBe(200);
    });

    it('sends upload.started only once the upload exists', async () => {
      const created = await tusCreate('a', video);
      const id = (created.headers.location as string).split('/').pop()!;
      const started = events.filter((e) => e.event === 'upload.started');
      expect(started).toHaveLength(1);
      expect(started[0].data.upload_id).toBe(id);
      expect(started[0].owner).toBe(A);
      expect(existsSync(path.join(uploadDir, id))).toBe(true);
    });

    it('discards the asset and sends no event when the store cannot create the upload', async () => {
      // a plain file where the upload directory should be: the store cannot
      // create the upload after the hook wrote the rows
      rmSync(uploadDir, { recursive: true, force: true });
      writeFileSync(uploadDir, 'not a directory');
      try {
        const res = await tusCreate('a', video);
        check('POST', '/api/v1/uploads', res);
        expect(res.status).toBe(500);
        expect(res.text).not.toContain(uploadDir);
        expect(res.text).not.toMatch(/EEXIST|ENOTDIR/);
      } finally {
        rmSync(uploadDir, { force: true });
        mkdirSync(uploadDir, { recursive: true });
      }
      expect(events.filter((e) => e.event === 'upload.started')).toHaveLength(0);
      const list = await call('GET', '/api/v1/assets', 'a');
      expect(list.body.total).toBe(2);
      const [session] = await tdb.sql<{ status: string }[]>`select status from upload_sessions`;
      expect(session.status).toBe('failed');
    });

    it('validates the creation metadata with 400 and creates nothing', async () => {
      const before = await countAssets(A);
      const cases: Array<[Record<string, string>, number | string]> = [
        [{ ...video, accessTier: 'bogus' }, 10],
        [{ ...video, accessTier: 'Private' }, 10],
        [{ ...video, access_tier: 'unlisted' }, 10],
        [{ ...video, title: 'x'.repeat(201) }, 10],
        [{ ...video, title: 'a\u0000b' }, 10],
        [{ ...video, description: 'x'.repeat(5001) }, 10],
        [video, 0],
      ];
      for (const [metadata, length] of cases) {
        const res = await tusCreate('a', metadata, length);
        check('POST', '/api/v1/uploads', res);
        expect(res.status, JSON.stringify(metadata) + length).toBe(400);
        expect(res.text).not.toMatch(/insert into|Failed query|video_assets/i);
      }
      const notVideo = await tusCreate('a', { ...video, filetype: 'image/png' });
      check('POST', '/api/v1/uploads', notVideo);
      expect(notVideo.status).toBe(415);
      const anonymous = await tusCreate('none', video);
      check('POST', '/api/v1/uploads', anonymous);
      expect(anonymous.status).toBe(401);
      const readOnly = await tusCreate('aRead', video);
      check('POST', '/api/v1/uploads', readOnly);
      expect(readOnly.status).toBe(403);
      const tooBig = await tusCreate('a', video, 20 * 1024 ** 4);
      check('POST', '/api/v1/uploads', tooBig);
      expect(tooBig.status).toBe(413);
      expect(await countAssets(A)).toBe(before);
    });

    it('accepts private uploads through either metadata spelling', async () => {
      const res = await tusCreate('a', { ...video, access_tier: 'private' });
      expect(res.status).toBe(201);
      const id = (res.headers.location as string).split('/').pop()!;
      const status = await call('GET', `/api/v1/uploads/${id}`, 'a');
      const asset = await call('GET', `/api/v1/assets/${status.body.video_asset_id}`, 'a');
      expect(asset.body.access_tier).toBe('private');
    });

    it('cancels an in-progress upload through REST: session cancelled, file and asset gone', async () => {
      const created = await tusCreate('a', video);
      const id = (created.headers.location as string).split('/').pop()!;
      const patched = await tusPatch('a', id, 0, Buffer.alloc(4));
      check('PATCH', '/api/v1/uploads/{id}', patched);
      expect(patched.status).toBe(204);
      const progress = await call('GET', `/api/v1/uploads/${id}`, 'a');
      // right after the PATCH, not a throttle interval later
      expect(progress.body).toMatchObject({ uploaded_bytes: 4, progress_percent: 40 });
      const assetId = progress.body.video_asset_id;

      const byB = await call('DELETE', `/api/v1/uploads/${id}`, 'b');
      check('DELETE', '/api/v1/uploads/{id}', byB);
      expect(byB.status).toBe(404);

      const res = await call('DELETE', `/api/v1/uploads/${id}`, 'a');
      check('DELETE', '/api/v1/uploads/{id}', res);
      expect(res.status).toBe(200);
      expect((await call('GET', `/api/v1/assets/${assetId}`, 'a')).status).toBe(404);
      expect(jobs).toContainEqual(
        expect.objectContaining({
          queue: 'deletion',
          data: { kind: 'delete', videoAssetId: assetId },
        }),
      );
      expect(existsSync(path.join(uploadDir, id))).toBe(false);
      expect(existsSync(path.join(uploadDir, `${id}.json`))).toBe(false);
      const status = await call('GET', `/api/v1/uploads/${id}`, 'a');
      expect(status.body.status).toBe('cancelled');

      const again = await call('DELETE', `/api/v1/uploads/${id}`, 'a');
      check('DELETE', '/api/v1/uploads/{id}', again);
      expect(again.status).toBe(409);
    });

    it('refuses to cancel a finished upload and keeps its source for a retry', async () => {
      const created = await tusCreate('a', video);
      const id = (created.headers.location as string).split('/').pop()!;
      expect((await tusPatch('a', id, 0, Buffer.alloc(10))).status).toBe(204);
      const status = await call('GET', `/api/v1/uploads/${id}`, 'a');
      expect(status.body.status).toBe('completed');
      expect(jobs).toContainEqual(expect.objectContaining({ queue: 'transcode' }));
      expect(events.map((e) => e.event)).toContain('upload.completed');

      const res = await call('DELETE', `/api/v1/uploads/${id}`, 'a');
      check('DELETE', '/api/v1/uploads/{id}', res);
      expect(res.status).toBe(409);
      expect(existsSync(path.join(uploadDir, id))).toBe(true);
    });

    it('does not let a tus DELETE remove a finished upload or its asset', async () => {
      const created = await tusCreate('aUpload', video);
      const id = (created.headers.location as string).split('/').pop()!;
      expect((await tusPatch('aUpload', id, 0, Buffer.alloc(10))).status).toBe(204);
      const assetId = (await call('GET', `/api/v1/uploads/${id}`, 'a')).body.video_asset_id;
      // the pipeline failed it, so its source is kept for a retry
      await tdb.sql`update video_assets set status = 'failed' where id = ${assetId}`;

      const res = await tusDelete('aUpload', id);
      check('DELETE', '/api/v1/uploads/{id}', { ...res, body: res.text });
      expect(res.status).toBe(400);
      expect((await call('GET', `/api/v1/assets/${assetId}`, 'a')).status).toBe(200);
      expect(existsSync(path.join(uploadDir, id))).toBe(true);
      expect(jobs.filter((j) => j.queue === 'deletion')).toHaveLength(0);
    });

    it('lets the uploader terminate its own unfinished upload through tus', async () => {
      const created = await tusCreate('aUpload', video);
      const id = (created.headers.location as string).split('/').pop()!;
      const assetId = (await call('GET', `/api/v1/uploads/${id}`, 'a')).body.video_asset_id;
      const byB = await tusDelete('b', id);
      expect(byB.status).toBe(404);
      const res = await tusDelete('aUpload', id);
      expect(res.status).toBe(204);
      expect((await call('GET', `/api/v1/assets/${assetId}`, 'a')).status).toBe(404);
      expect((await call('GET', `/api/v1/uploads/${id}`, 'a')).body.status).toBe('cancelled');
    });

    it('expires abandoned uploads: session failed, asset discarded, files removed', async () => {
      const created = await tusCreate('a', video);
      const id = (created.headers.location as string).split('/').pop()!;
      const assetId = (await call('GET', `/api/v1/uploads/${id}`, 'a')).body.video_asset_id;

      // a finished upload whose processing failed keeps everything
      const kept = await tusCreate('a', video);
      const keptId = (kept.headers.location as string).split('/').pop()!;
      await tusPatch('a', keptId, 0, Buffer.alloc(10));
      const keptAsset = (await call('GET', `/api/v1/uploads/${keptId}`, 'a')).body.video_asset_id;
      await tdb.sql`update video_assets set status = 'failed' where id = ${keptAsset}`;

      await tdb.sql`update upload_sessions set expires_at = now() - interval '1 hour'`;
      const expired = await built.expireAbandonedUploads();
      expect(expired).toBe(1);

      expect((await call('GET', `/api/v1/uploads/${id}`, 'a')).body.status).toBe('failed');
      expect((await call('GET', `/api/v1/assets/${assetId}`, 'a')).status).toBe(404);
      expect(existsSync(path.join(uploadDir, id))).toBe(false);
      expect((await call('GET', `/api/v1/assets/${keptAsset}`, 'a')).status).toBe(200);
      expect(existsSync(path.join(uploadDir, keptId))).toBe(true);

      // a second sweep has nothing left to do
      expect(await built.expireAbandonedUploads()).toBe(0);
    });
  });

  // ── operator data (D11): tenants get a health summary only ─────────────

  describe('operator data', () => {
    beforeEach(async () => {
      await tdb.sql`
        insert into reconciliation_runs
          (started_at, finished_at, status, db_object_count, indexer_object_count,
           in_sync_count, orphan_count, missing_count, orphaned_ids, missing_ids, error_message)
        values (now(), now(), 'drift', 3, 3, 1, 1, 2,
          ${tdb.sql.json(['ff'.repeat(32)])}, ${tdb.sql.json(['a1'.repeat(32), 'b1'.repeat(32)])}, null)
      `;
    });

    it('gives a tenant a status summary without deployment data', async () => {
      const res = await call('GET', '/api/v1/system/status', 'a');
      check('GET', '/api/v1/system/status', res);
      expect(res.status).toBe(200);
      expect(res.body.scope).toBe('account');
      expect(res.body.indexer.account).toBeUndefined();
      expect(res.body.indexer.url).toBeUndefined();
      expect(res.body.indexer.error).toBeUndefined();
      expect(res.body.cache).toBeUndefined();
      expect(res.body.reconciliation).toBeUndefined();
      expect(res.body.uptime_seconds).toBeUndefined();
      expect(typeof res.body.database.ok).toBe('boolean');
      expect(res.body.database.error).toBeUndefined();
      expect(res.body.indexer.ok).toBe(false);
      expect(JSON.stringify(res.body)).not.toContain('127.0.0.1');
    });

    it('gives the platform key the full status', async () => {
      const res = await call('GET', '/api/v1/system/status', 'platform');
      check('GET', '/api/v1/system/status', res);
      expect(res.status).toBe(200);
      expect(res.body.scope).toBe('deployment');
      expect(res.body.indexer.url).toBe('http://127.0.0.1:9');
      expect(typeof res.body.indexer.error).toBe('string');
      expect(res.body.cache).toBeDefined();
      expect(res.body.reconciliation.status).toBe('drift');
      expect(typeof res.body.uptime_seconds).toBe('number');
    });

    it('keeps the process metrics to the platform key', async () => {
      const tenant = await call('GET', '/api/v1/metrics', 'a');
      check('GET', '/api/v1/metrics', tenant);
      expect(tenant.status).toBe(403);
      const platform = await call('GET', '/api/v1/metrics', 'platform');
      check('GET', '/api/v1/metrics', platform);
      expect(platform.status).toBe(200);
    });

    it('gives a tenant only its own drift, and the platform key the whole run', async () => {
      const tenant = await call('GET', '/api/v1/reconciliation', 'a');
      check('GET', '/api/v1/reconciliation', tenant);
      expect(tenant.status).toBe(200);
      expect(tenant.body).toMatchObject({
        scope: 'account',
        status: 'drift',
        missing_count: 1,
        missing_ids: ['a1'.repeat(32)],
      });
      for (const field of [
        'db_object_count',
        'indexer_object_count',
        'in_sync_count',
        'orphan_count',
        'orphaned_ids',
        'error_message',
      ]) {
        expect(tenant.body[field], field).toBeUndefined();
      }

      const platform = await call('GET', '/api/v1/reconciliation', 'platform');
      check('GET', '/api/v1/reconciliation', platform);
      expect(platform.body).toMatchObject({
        scope: 'deployment',
        missing_count: 2,
        orphan_count: 1,
        orphaned_ids: ['ff'.repeat(32)],
      });
    });

    it('lets only the platform key start a deployment-wide run', async () => {
      const tenant = await call('POST', '/api/v1/reconciliation/run', 'a');
      check('POST', '/api/v1/reconciliation/run', tenant);
      expect(tenant.status).toBe(403);
      expect(reconcileTriggers).toBe(0);
      const platform = await call('POST', '/api/v1/reconciliation/run', 'platform');
      check('POST', '/api/v1/reconciliation/run', platform);
      expect(platform.status).toBe(202);
      expect(reconcileTriggers).toBe(1);
    });

    it('answers 404 before any run has finished', async () => {
      await tdb.sql`delete from reconciliation_runs`;
      const res = await call('GET', '/api/v1/reconciliation', 'a');
      check('GET', '/api/v1/reconciliation', res);
      expect(res.status).toBe(404);
    });

    it('scopes library stats to the tenant', async () => {
      const res = await call('GET', '/api/v1/stats', 'a');
      check('GET', '/api/v1/stats', res);
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(2);
    });
  });

  // ── studio sessions ───────────────────────────────────────────────────

  describe('auth', () => {
    async function sessionCookie(login: string) {
      const { createStudioSession } = await import('../db/queries/sessions.js');
      const { signSession, SESSION_COOKIE_NAME } = await import('../api/auth/session.js');
      const { env } = await import('../config/env.js');
      const row = await createStudioSession({
        login,
        expiresAt: new Date(Date.now() + 3600_000),
        userAgent: 'contract-test',
      });
      return {
        id: row.id,
        cookie: `${SESSION_COOKIE_NAME}=${signSession(row.id, login, env.SESSION_SECRET)}`,
      };
    }

    it('answers /auth/me in snake_case with an ISO expiry', async () => {
      const anonymous = await call('GET', '/api/v1/auth/me', 'none');
      check('GET', '/api/v1/auth/me', anonymous);
      expect(anonymous.status).toBe(401);

      const { cookie } = await sessionCookie('alice');
      const me = await request(app).get('/api/v1/auth/me').set('Cookie', cookie);
      check('GET', '/api/v1/auth/me', me);
      expect(me.status).toBe(200);
      expect(me.body.login).toBe('alice');
      expect(me.body.auth_disabled).toBe(false);
      expect(Number.isNaN(Date.parse(me.body.expires_at))).toBe(false);
    });

    it('lists and ends sessions only for a signed-in browser', async () => {
      const withKey = await call('GET', '/api/v1/auth/sessions', 'a');
      check('GET', '/api/v1/auth/sessions', withKey);
      expect(withKey.status).toBe(401);

      const mine = await sessionCookie('alice');
      const other = await sessionCookie('bob');
      const list = await request(app).get('/api/v1/auth/sessions').set('Cookie', mine.cookie);
      check('GET', '/api/v1/auth/sessions', list);
      expect(list.body.data).toHaveLength(1);

      const notMine = await request(app)
        .delete(`/api/v1/auth/sessions/${other.id}`)
        .set('Cookie', mine.cookie);
      check('DELETE', '/api/v1/auth/sessions/{id}', notMine);
      expect(notMine.status).toBe(404);

      const second = await sessionCookie('alice');
      const endOne = await request(app)
        .delete(`/api/v1/auth/sessions/${second.id}`)
        .set('Cookie', mine.cookie);
      check('DELETE', '/api/v1/auth/sessions/{id}', endOne);
      expect(endOne.status).toBe(200);

      const endAll = await request(app).delete('/api/v1/auth/sessions').set('Cookie', mine.cookie);
      check('DELETE', '/api/v1/auth/sessions', endAll);
      expect(endAll.status).toBe(200);

      const anonymousEndAll = await call('DELETE', '/api/v1/auth/sessions', 'none');
      check('DELETE', '/api/v1/auth/sessions', anonymousEndAll);
      expect(anonymousEndAll.status).toBe(401);

      const logout = await request(app).post('/api/v1/auth/logout').set('Cookie', other.cookie);
      check('POST', '/api/v1/auth/logout', logout);
      expect(logout.status).toBe(200);
    });

    it('documents the github login redirect and the callback refusals', async () => {
      const login = await call('GET', '/api/v1/auth/github/login', 'none');
      check('GET', '/api/v1/auth/github/login', login);
      expect(login.status).toBe(302);
      const missing = await call('GET', '/api/v1/auth/github/callback', 'none');
      check('GET', '/api/v1/auth/github/callback', missing);
      expect(missing.status).toBe(400);
      const badState = await call('GET', '/api/v1/auth/github/callback?code=x&state=nope', 'none');
      check('GET', '/api/v1/auth/github/callback', badState);
      expect(badState.status).toBe(400);
    });
  });

  // ── delivery gateway ──────────────────────────────────────────────────

  describe('delivery', () => {
    it('answers 404 for unknown objects and assets, 403 for unsigned private ones', async () => {
      const object = await call('GET', `/v1/objects/${'cd'.repeat(32)}`, 'none');
      check('GET', '/v1/objects/{objectId}', object);
      expect(object.status).toBe(404);

      const stream = await call('GET', `/v1/stream/${assetADeleted.id}/master.m3u8`, 'none');
      check('GET', '/v1/stream/{videoAssetId}/master.m3u8', stream);
      expect(stream.status).toBe(404);

      await tdb.sql`update video_assets set access_tier = 'private' where id = ${assetB.id}`;
      const gated = await call('GET', `/v1/stream/${assetB.id}/master.m3u8`, 'none');
      check('GET', '/v1/stream/{videoAssetId}/master.m3u8', gated);
      expect(gated.status).toBe(403);

      const share = await call('GET', `/v1/share/${assetADeleted.id}`, 'none');
      check('GET', '/v1/share/{id}', share);
      expect(share.status).toBe(404);
      const gatedShare = await call('GET', `/v1/share/${assetB.id}`, 'none');
      check('GET', '/v1/share/{id}', gatedShare);
      expect(gatedShare.status).toBe(403);

      const stats = await call('GET', '/v1/cache/stats', 'none');
      check('GET', '/v1/cache/stats', stats);
      expect(stats.status).toBe(200);
    });
  });

  // runs last: vitest runs the tests of a file in order
  it('exercised every operation in the OpenAPI document', () => {
    const missing = documentedOperations().filter((op) => !spec.seen.has(op));
    expect(missing, `never exercised:\n${missing.join('\n')}`).toEqual([]);
  });
});
