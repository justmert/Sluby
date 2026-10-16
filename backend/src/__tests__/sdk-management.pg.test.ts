/**
 * The sdk's management calls (api keys, webhook endpoints, playback ids,
 * renditions, stats) against the real backend: @sluby/sdk from source and the
 * shipped app.ts over a real Postgres database, as sdk-uploads.pg.test.ts
 * does for uploads. Webhook test sends go to a real local receiver.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { hasTestDatabase, createTestDatabase, type TestDatabase } from './helpers/pg.js';
import { answer, startReceiver } from './helpers/webhook-receiver.js';
import { buildStorageRecords } from '../storage/artifact-records.js';
import type * as AppModule from '../app.js';
import type * as KeyQueries from '../db/queries/api-keys.js';
import type * as AssetQueries from '../db/queries/assets.js';
import type * as StorageQueries from '../db/queries/storage-records.js';
import type * as EnvModule from '../config/env.js';

const ALICE = 'github:alice';
const BOB = 'github:bob';
const ALICE_KEY = `sluby_${'a'.repeat(40)}`;
const BOB_KEY = `sluby_${'b'.repeat(40)}`;

// the sdk is loaded from its source at run time (see sdk-uploads.pg.test.ts);
// these are the parts of its surface the tests use
interface ApiKey {
  id: string;
  name: string;
  scopes: string[];
  rateLimit: number;
  isActive: boolean;
  createdAt: string;
  expiresAt: string | null;
  prefix: string | null;
  lastUsedAt: string | null;
}
interface Endpoint {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  createdAt: string;
  lastDeliveryAt: string | null;
  lastDeliveryOk: boolean | null;
}
interface Asset {
  id: string;
  title: string;
  updatedAt: string;
  playCount: number;
  lastPlayedAt: string | null;
}
interface SdkClient {
  keys: {
    list: (o?: { limit?: number; cursor?: string }) => Promise<{
      data: ApiKey[];
      hasMore: boolean;
      nextCursor: string | null;
      limits: { maxKeys: number; maxRateLimit: number };
    }>;
    update: (id: string, i: { name: string }) => Promise<ApiKey>;
    create: (i: {
      name: string;
      scopes?: string[];
      rateLimit?: number;
    }) => Promise<ApiKey & { key: string }>;
    rotate: (
      id: string,
      o?: { gracePeriodSeconds?: number },
    ) => Promise<ApiKey & { key: string; rotatedFrom: string; previousKeyExpiresAt: string }>;
    revoke: (id: string) => Promise<void>;
  };
  webhookEndpoints: {
    list: () => Promise<Endpoint[]>;
    get: (id: string) => Promise<Endpoint>;
    update: (
      id: string,
      i: { url?: string; events?: string[]; isActive?: boolean },
    ) => Promise<Endpoint>;
    rotateSecret: (id: string) => Promise<{ id: string; secret: string }>;
    redeliver: (id: string, deliveryId: string) => Promise<{ deliveryId: string }>;
    create: (i: {
      url: string;
      events: string[];
    }) => Promise<{ id: string; url: string; events: string[]; secret: string }>;
    delete: (id: string) => Promise<void>;
    test: (
      id: string,
    ) => Promise<{ delivered: boolean; statusCode: number | null; error: string | null }>;
    deliveries: (
      id: string,
      o?: { limit?: number },
    ) => Promise<
      Array<{
        id: string;
        eventId: string | null;
        event: string;
        statusCode: number | null;
        delivered: boolean;
        error: string | null;
        attempt: number;
        createdAt: string;
        payload: Record<string, unknown>;
        manual: boolean;
      }>
    >;
  };
  reconciliation: {
    latest: () => Promise<{
      scope: string;
      status: string;
      missingIds: string[];
      missingObjects: Array<{
        objectId: string;
        videoAssetId: string | null;
        title: string | null;
      }>;
    }>;
    run: () => Promise<{ enqueued: boolean; alreadyPending: boolean }>;
  };
  webhooks: {
    verifyRequest: (rawBody: string, headers: http.IncomingHttpHeaders, secret: string) => boolean;
  };
  playbackIds: {
    list: (
      assetId: string,
    ) => Promise<
      Array<{ id: string; playbackId: string; policy: string; name: string; createdAt: string }>
    >;
    create: (
      assetId: string,
      i?: { policy?: 'public' | 'signed'; name?: string },
    ) => Promise<{
      id: string;
      playbackId: string;
      policy: string;
      name: string;
      createdAt: string;
    }>;
    delete: (playbackId: string) => Promise<void>;
  };
  assets: {
    get: (id: string) => Promise<Asset>;
    update: (
      id: string,
      data: { title?: string },
      o?: { ifMatch?: Asset | string },
    ) => Promise<Asset>;
    usage: (o?: {
      days?: number;
    }) => Promise<{ days: Array<{ date: string; plays: number }>; total: number }>;
    processing: (id: string) => Promise<{ status: string; retryable: boolean }>;
    renditions: (id: string) => Promise<unknown[]>;
    stats: () => Promise<{
      total: number;
      byStatus: Record<string, number>;
      storedBytes: number;
      readyDurationMs: number;
      objectCount: number;
    }>;
  };
}
interface SdkModule {
  SlubyClient: new (config: { apiKey: string; baseUrl: string }) => SdkClient;
  NotFoundError: new (...args: never[]) => Error;
  ConflictError: new (...args: never[]) => Error & { statusCode: number; current?: Asset };
  AuthenticationError: new (...args: never[]) => Error;
  PermissionError: new (...args: never[]) => Error;
}
const SDK_ENTRY = new URL('../../../packages/sdk/src/index.ts', import.meta.url).href;

describe.skipIf(!hasTestDatabase)('sdk management calls against the backend (postgres)', () => {
  let tdb: TestDatabase;
  let server: http.Server;
  let baseUrl: string;
  let sdk: SdkModule;
  let alice: SdkClient;
  let bob: SdkClient;
  let keys: typeof KeyQueries;
  let assets: typeof AssetQueries;
  let storage: typeof StorageQueries;
  let envModule: typeof EnvModule;
  let closeDatabase: () => Promise<void>;
  let uploadDir: string;
  let outputDir: string;

  const fakeQueue = () => ({
    add: async () => {},
    getJobCounts: async () => ({ waiting: 0, active: 0, delayed: 0 }),
  });

  beforeAll(async () => {
    server = http.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    uploadDir = mkdtempSync(path.join(os.tmpdir(), 'sluby-sdk-mgmt-up-'));
    outputDir = mkdtempSync(path.join(os.tmpdir(), 'sluby-sdk-mgmt-out-'));
    process.env.UPLOAD_DIR = uploadDir;
    process.env.TRANSCODE_OUTPUT_DIR = outputDir;
    process.env.PUBLIC_URL = baseUrl;
    process.env.AUTH_DISABLED = 'false';
    process.env.SIA_INDEXER_URL = 'http://127.0.0.1:9';

    tdb = await createTestDatabase();
    const appModule: typeof AppModule = await import('../app.js');
    keys = await import('../db/queries/api-keys.js');
    assets = await import('../db/queries/assets.js');
    storage = await import('../db/queries/storage-records.js');
    envModule = await import('../config/env.js');
    ({ closeDatabase } = await import('../config/database.js'));
    sdk = (await import(SDK_ENTRY)) as SdkModule;

    const { app } = appModule.createApp({
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
    });
    server.on('request', app);
    alice = new sdk.SlubyClient({ apiKey: ALICE_KEY, baseUrl });
    bob = new sdk.SlubyClient({ apiKey: BOB_KEY, baseUrl });
  }, 60_000);

  afterAll(async () => {
    server?.closeAllConnections();
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    await closeDatabase?.();
    await tdb?.drop();
    rmSync(uploadDir, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await tdb.truncate();
    for (const [creatorAddress, rawKey] of [
      [ALICE, ALICE_KEY],
      [BOB, BOB_KEY],
    ]) {
      await keys.createApiKey({
        name: 'sdk',
        scopes: ['upload', 'read', 'manage'],
        creatorAddress,
        rawKey,
      });
    }
  });

  it('creates, pages, rotates and revokes api keys', async () => {
    const created = await alice.keys.create({ name: 'ci', scopes: ['read'], rateLimit: 30 });
    expect(created).toMatchObject({
      name: 'ci',
      scopes: ['read'],
      rateLimit: 30,
      isActive: true,
      expiresAt: null,
    });
    expect(created.key).toMatch(/^sluby_/);

    // two keys (the seeded one and the new one), one per page, newest first
    const first = await alice.keys.list({ limit: 1 });
    expect(first.data.map((k) => k.id)).toEqual([created.id]);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).not.toBeNull();
    const second = await alice.keys.list({ limit: 1, cursor: first.nextCursor! });
    expect(second.data).toHaveLength(1);
    expect(second.data[0].name).toBe('sdk');
    expect(second.hasMore).toBe(false);
    expect(second.nextCursor).toBeNull();

    // the new secret works, and the old one keeps working through the grace period
    const rotated = await alice.keys.rotate(created.id, { gracePeriodSeconds: 600 });
    expect(rotated.rotatedFrom).toBe(created.id);
    expect(rotated.id).not.toBe(created.id);
    expect(rotated.key).not.toBe(created.key);
    expect(rotated).toMatchObject({ name: 'ci', scopes: ['read'], rateLimit: 30 });
    expect(Date.parse(rotated.previousKeyExpiresAt)).toBeGreaterThan(Date.now() + 500_000);
    const listed = (await alice.keys.list()).data;
    expect(listed.find((k) => k.id === created.id)?.expiresAt).toBe(rotated.previousKeyExpiresAt);
    await expect(alice.keys.rotate(created.id)).rejects.toBeInstanceOf(sdk.ConflictError);

    // another account cannot see or revoke it
    await expect(bob.keys.revoke(rotated.id)).rejects.toBeInstanceOf(sdk.NotFoundError);
    expect((await bob.keys.list()).data.map((k) => k.id)).not.toContain(rotated.id);

    const withNewKey = new sdk.SlubyClient({ apiKey: rotated.key, baseUrl });
    await expect(withNewKey.assets.stats()).resolves.toMatchObject({ total: 0 });
    await alice.keys.revoke(rotated.id);
    await expect(withNewKey.assets.stats()).rejects.toBeInstanceOf(sdk.AuthenticationError);
    await expect(alice.keys.revoke(rotated.id)).rejects.toBeInstanceOf(sdk.NotFoundError);
  });

  it('registers, tests, lists the deliveries of and deletes a webhook endpoint', async () => {
    const receiver = await startReceiver((_n, res) => answer(res, 204));
    const previous = envModule.env.WEBHOOK_ALLOWED_NETWORKS;
    envModule.env.WEBHOOK_ALLOWED_NETWORKS = '127.0.0.0/8';
    try {
      const created = await alice.webhookEndpoints.create({
        url: receiver.url,
        events: ['asset.ready', 'asset.errored'],
      });
      expect(created).toMatchObject({
        url: receiver.url,
        events: ['asset.ready', 'asset.errored'],
      });
      expect(created.secret).toMatch(/^[0-9a-f]{64}$/);

      const listed = await alice.webhookEndpoints.list();
      expect(listed).toEqual([
        {
          id: created.id,
          url: receiver.url,
          events: ['asset.ready', 'asset.errored'],
          isActive: true,
          createdAt: expect.any(String),
          lastDeliveryAt: null,
          lastDeliveryOk: null,
        },
      ]);
      expect(await bob.webhookEndpoints.list()).toEqual([]);

      const tested = await alice.webhookEndpoints.test(created.id);
      expect(tested).toEqual({ delivered: true, statusCode: 204, error: null });
      // the secret from create verifies what the receiver got
      const [req] = receiver.requests;
      expect(req.headers['x-sluby-event']).toBe('webhook.test');
      expect(alice.webhooks.verifyRequest(req.body, req.headers, created.secret)).toBe(true);

      const deliveries = await alice.webhookEndpoints.deliveries(created.id, { limit: 10 });
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]).toMatchObject({
        event: 'webhook.test',
        statusCode: 204,
        delivered: true,
        error: null,
        attempt: 1,
      });
      await expect(bob.webhookEndpoints.deliveries(created.id)).rejects.toBeInstanceOf(
        sdk.NotFoundError,
      );
      await expect(bob.webhookEndpoints.test(created.id)).rejects.toBeInstanceOf(sdk.NotFoundError);

      await expect(bob.webhookEndpoints.delete(created.id)).rejects.toBeInstanceOf(
        sdk.NotFoundError,
      );
      await alice.webhookEndpoints.delete(created.id);
      expect(await alice.webhookEndpoints.list()).toEqual([]);
    } finally {
      envModule.env.WEBHOOK_ALLOWED_NETWORKS = previous;
      await receiver.close();
    }
  });

  it("creates, lists and deletes an asset's playback ids", async () => {
    const asset = await assets.createVideoAsset({ title: 'v', creatorAddress: ALICE });

    const signed = await alice.playbackIds.create(asset.id, { policy: 'signed', name: 'embed' });
    expect(signed).toMatchObject({ policy: 'signed', name: 'embed' });
    expect(signed.playbackId).toMatch(/^pb_/);
    const plain = await alice.playbackIds.create(asset.id);
    expect(plain).toMatchObject({ policy: 'public', name: '' });

    const listed = await alice.playbackIds.list(asset.id);
    expect(listed.map((p) => p.playbackId).sort()).toEqual(
      [signed.playbackId, plain.playbackId].sort(),
    );
    await expect(bob.playbackIds.list(asset.id)).rejects.toBeInstanceOf(sdk.NotFoundError);
    await expect(bob.playbackIds.create(asset.id)).rejects.toBeInstanceOf(sdk.NotFoundError);
    await expect(bob.playbackIds.delete(signed.playbackId)).rejects.toBeInstanceOf(
      sdk.NotFoundError,
    );

    await alice.playbackIds.delete(signed.playbackId);
    expect((await alice.playbackIds.list(asset.id)).map((p) => p.playbackId)).toEqual([
      plain.playbackId,
    ]);
  });

  it('reads the renditions of a ready asset and the library totals', async () => {
    const ready = await assets.createVideoAsset({ title: 'ready', creatorAddress: ALICE });
    await assets.updateVideoAsset(ready.id, { status: 'processing' });
    const outcome = await storage.finalizeAssetStorage(ready.id, {
      records: buildStorageRecords({
        variants: [
          {
            name: '360p',
            width: 640,
            height: 360,
            videoBitrateKbps: 900,
            segmentCount: 2,
            dataObjectId: 'r360-data',
            dataByteSize: 1000,
            playlistObjectId: 'r360-playlist',
            playlistByteSize: 100,
          },
          {
            name: '720p',
            width: 1280,
            height: 720,
            videoBitrateKbps: 2800,
            segmentCount: 2,
            dataObjectId: 'r720-data',
            dataByteSize: 3000,
            playlistObjectId: 'r720-playlist',
            playlistByteSize: 100,
          },
        ],
        thumbnails: [{ objectId: 'thumb', byteSize: 10 }],
        master: { objectId: 'master', byteSize: 50 },
      }),
      manifestObjectId: 'master',
      thumbnailObjectIds: ['thumb'],
      siaObjectIds: ['r360-data', 'r360-playlist', 'r720-data', 'r720-playlist', 'thumb', 'master'],
      durationMs: 4000,
      resolution: '1280x720',
      segmentCount: 2,
      totalStorageBytes: 4260,
    });
    expect(outcome.outcome).toBe('ready');
    const pending = await assets.createVideoAsset({ title: 'new', creatorAddress: ALICE });
    // another account's asset counts only for that account
    await assets.createVideoAsset({ title: 'bob', creatorAddress: BOB });

    expect(await alice.assets.renditions(ready.id)).toEqual([
      {
        name: '720p',
        width: 1280,
        height: 720,
        videoBitrateKbps: 2800,
        segmentCount: 2,
        byteSize: 3000,
        dataObjectId: 'r720-data',
        playlistObjectId: 'r720-playlist',
      },
      {
        name: '360p',
        width: 640,
        height: 360,
        videoBitrateKbps: 900,
        segmentCount: 2,
        byteSize: 1000,
        dataObjectId: 'r360-data',
        playlistObjectId: 'r360-playlist',
      },
    ]);
    expect(await alice.assets.renditions(pending.id)).toEqual([]);
    await expect(bob.assets.renditions(ready.id)).rejects.toBeInstanceOf(sdk.NotFoundError);

    expect(await alice.assets.stats()).toEqual({
      total: 2,
      byStatus: { created: 1, uploading: 0, processing: 0, ready: 1, failed: 0 },
      storedBytes: 4260,
      readyDurationMs: 4000,
      objectCount: 6,
    });
    expect((await bob.assets.stats()).total).toBe(1);
  });

  it('renames a key, and reports its prefix, last use and the key limits', async () => {
    const created = await alice.keys.create({ name: 'ci', scopes: ['read'] });
    expect(created.prefix).toBe(created.key.slice(0, 12));
    expect(created.lastUsedAt).toBeNull();
    const page = await alice.keys.list();
    expect(page.limits).toEqual({ maxKeys: 100, maxRateLimit: 10000 });

    const renamed = await alice.keys.update(created.id, { name: 'deploy bot' });
    expect(renamed).toMatchObject({ id: created.id, name: 'deploy bot', prefix: created.prefix });
    await expect(bob.keys.update(created.id, { name: 'x' })).rejects.toBeInstanceOf(
      sdk.NotFoundError,
    );

    await new sdk.SlubyClient({ apiKey: created.key, baseUrl }).assets.stats();
    // the use is written after the request answers
    await vi.waitFor(async () => {
      const key = (await alice.keys.list()).data.find((k) => k.id === created.id);
      expect(key?.lastUsedAt).not.toBeNull();
    });
  });

  it('gets, pauses, re-points, rotates the secret of and resends to a webhook endpoint', async () => {
    const receiver = await startReceiver((_n, res) => answer(res, 204));
    const previous = envModule.env.WEBHOOK_ALLOWED_NETWORKS;
    envModule.env.WEBHOOK_ALLOWED_NETWORKS = '127.0.0.0/8';
    try {
      const created = await alice.webhookEndpoints.create({
        url: receiver.url,
        events: ['asset.ready'],
      });
      await alice.webhookEndpoints.test(created.id);
      const got = await alice.webhookEndpoints.get(created.id);
      expect(got).toMatchObject({ id: created.id, isActive: true, lastDeliveryOk: true });
      expect(got.lastDeliveryAt).not.toBeNull();
      await expect(bob.webhookEndpoints.get(created.id)).rejects.toBeInstanceOf(sdk.NotFoundError);

      const [delivery] = await alice.webhookEndpoints.deliveries(created.id);
      expect(delivery.manual).toBe(false);
      expect(delivery.payload).toMatchObject({ id: delivery.eventId, event: 'webhook.test' });
      const resent = await alice.webhookEndpoints.redeliver(created.id, delivery.id);
      expect(resent.deliveryId).toMatch(/^dlv_/);

      const paused = await alice.webhookEndpoints.update(created.id, {
        isActive: false,
        events: ['asset.ready', 'asset.errored'],
      });
      expect(paused).toMatchObject({ isActive: false, events: ['asset.ready', 'asset.errored'] });
      await expect(
        alice.webhookEndpoints.redeliver(created.id, delivery.id),
      ).rejects.toBeInstanceOf(sdk.ConflictError);
      await expect(
        bob.webhookEndpoints.update(created.id, { isActive: true }),
      ).rejects.toBeInstanceOf(sdk.NotFoundError);

      const rotated = await alice.webhookEndpoints.rotateSecret(created.id);
      expect(rotated.id).toBe(created.id);
      expect(rotated.secret).not.toBe(created.secret);
      await alice.webhookEndpoints.update(created.id, { isActive: true });
      receiver.requests.length = 0;
      await alice.webhookEndpoints.test(created.id);
      const [req] = receiver.requests;
      // signed with the new secret only
      expect(alice.webhooks.verifyRequest(req.body, req.headers, rotated.secret)).toBe(true);
      expect(alice.webhooks.verifyRequest(req.body, req.headers, created.secret)).toBe(false);
      await alice.webhookEndpoints.delete(created.id);
    } finally {
      envModule.env.WEBHOOK_ALLOWED_NETWORKS = previous;
      await receiver.close();
    }
  });

  it('refuses an edit based on an old version with a ConflictError carrying the current asset', async () => {
    const asset = await assets.createVideoAsset({ title: 'v', creatorAddress: ALICE });
    const read = await alice.assets.get(asset.id);
    expect(read).toMatchObject({ playCount: 0, lastPlayedAt: null });

    const mine = await alice.assets.update(asset.id, { title: 'tab one' }, { ifMatch: read });
    expect(mine.title).toBe('tab one');
    const err = await alice.assets
      .update(asset.id, { title: 'tab two' }, { ifMatch: read })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(sdk.ConflictError);
    const conflict = err as InstanceType<SdkModule['ConflictError']>;
    expect(conflict.statusCode).toBe(412);
    expect(conflict.current?.title).toBe('tab one');
    // retried on the version it carries, the edit goes through
    const retried = await alice.assets.update(
      asset.id,
      { title: 'tab two' },
      { ifMatch: conflict.current },
    );
    expect(retried.title).toBe('tab two');
  });

  it('reads plays per day and whether a failed video can be retried', async () => {
    const asset = await assets.createVideoAsset({ title: 'v', creatorAddress: ALICE });
    const today = new Date().toISOString().slice(0, 10);
    await tdb.sql`insert into asset_plays_daily (video_asset_id, day, plays) values (${asset.id}, ${today}, 2)`;
    const usage = await alice.assets.usage({ days: 3 });
    expect(usage.days).toHaveLength(3);
    expect(usage.days[2]).toEqual({ date: today, plays: 2 });
    expect(usage.total).toBe(2);
    expect((await bob.assets.usage()).total).toBe(0);
    expect((await alice.assets.get(asset.id)).playCount).toBe(2);

    const failed = await assets.createVideoAsset({
      title: 'broken',
      creatorAddress: ALICE,
      status: 'failed',
    });
    const [session] = await tdb.sql`
      insert into upload_sessions (video_asset_id, upload_url, file_path, file_size, status)
      values (${failed.id}, 'u', '/nowhere/gone.mp4', 10, 'completed') returning id`;
    await tdb.sql`
      insert into processing_jobs (video_asset_id, upload_session_id, status, retryable)
      values (${failed.id}, ${session.id}, 'failed', false)`;
    expect(await alice.assets.processing(failed.id)).toMatchObject({
      status: 'failed',
      retryable: false,
    });
  });

  it('reads the storage check with the video of each missing object, scoped to the account', async () => {
    const mine = await assets.createVideoAsset({
      title: 'Mine',
      creatorAddress: ALICE,
      manifestObjectId: 'a1'.repeat(32),
    });
    const theirs = await assets.createVideoAsset({
      title: 'Theirs',
      creatorAddress: BOB,
      manifestObjectId: 'b1'.repeat(32),
    });
    await tdb.sql`
      insert into reconciliation_runs
        (started_at, finished_at, status, db_object_count, indexer_object_count,
         in_sync_count, orphan_count, missing_count, orphaned_ids, missing_ids, error_message)
      values (now(), now(), 'drift', 2, 0, 0, 0, 2, ${tdb.sql.json([])},
        ${tdb.sql.json(['a1'.repeat(32), 'b1'.repeat(32)])}, null)`;

    const report = await alice.reconciliation.latest();
    expect(report).toMatchObject({ scope: 'account', status: 'drift' });
    expect(report.missingObjects).toEqual([
      { objectId: 'a1'.repeat(32), videoAssetId: mine.id, title: 'Mine' },
    ]);
    expect((await bob.reconciliation.latest()).missingObjects).toEqual([
      { objectId: 'b1'.repeat(32), videoAssetId: theirs.id, title: 'Theirs' },
    ]);
    // starting a check is for the platform identity and operators
    await expect(alice.reconciliation.run()).rejects.toBeInstanceOf(sdk.PermissionError);
  });
});
