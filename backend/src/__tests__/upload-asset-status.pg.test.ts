/**
 * The asset status while an upload's bytes arrive, through the shipped app.ts
 * (tus server, file store, adapters, queries) over a real Postgres database.
 * Queues are in-memory stand-ins, as in the contract test.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import pino from 'pino';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import { hasTestDatabase, createTestDatabase, type TestDatabase } from './helpers/pg.js';
import type * as AppModule from '../app.js';
import type * as KeyQueries from '../db/queries/api-keys.js';
import type * as AssetQueries from '../db/queries/assets.js';

const OWNER = 'github:alice';
const RAW_KEY = `sluby_${'a'.repeat(40)}`;
const TUS = { 'Tus-Resumable': '1.0.0', Authorization: `Bearer ${RAW_KEY}` };
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

describe.skipIf(!hasTestDatabase)('asset status during an upload (postgres)', () => {
  let tdb: TestDatabase;
  let app: Express;
  let expireAbandonedUploads: () => Promise<number>;
  let keys: typeof KeyQueries;
  let assets: typeof AssetQueries;
  let closeDatabase: () => Promise<void>;
  let uploadDir: string;
  let outputDir: string;
  const enqueued: string[] = [];

  const fakeQueue = (name: string) => ({
    add: async (_job: string, data: { videoAssetId?: string }) => {
      enqueued.push(`${name}:${data.videoAssetId}`);
    },
    getJobCounts: async () => ({ waiting: 0, active: 0, delayed: 0 }),
  });

  beforeAll(async () => {
    uploadDir = mkdtempSync(path.join(os.tmpdir(), 'sluby-status-up-'));
    outputDir = mkdtempSync(path.join(os.tmpdir(), 'sluby-status-out-'));
    process.env.UPLOAD_DIR = uploadDir;
    process.env.TRANSCODE_OUTPUT_DIR = outputDir;
    process.env.PUBLIC_URL = 'https://sluby.test';
    process.env.AUTH_DISABLED = 'false';
    process.env.SIA_INDEXER_URL = 'http://127.0.0.1:9';

    tdb = await createTestDatabase();
    const appModule: typeof AppModule = await import('../app.js');
    keys = await import('../db/queries/api-keys.js');
    assets = await import('../db/queries/assets.js');
    ({ closeDatabase } = await import('../config/database.js'));
    ({ app, expireAbandonedUploads } = appModule.createApp({
      logger: pino({ level: 'silent' }),
      version: '9.9.9-test',
      startedAt: new Date(),
      queues: {
        transcode: fakeQueue('transcode'),
        uploadSegments: fakeQueue('upload'),
        finalize: fakeQueue('finalize'),
        deletion: fakeQueue('deletion'),
      },
      pingRedis: async () => {},
      webhookDispatcher: { dispatch: async () => {} },
      triggerReconciliation: async () => ({ enqueued: true }),
    }));
  }, 60_000);

  afterAll(async () => {
    await closeDatabase?.();
    await tdb?.drop();
    rmSync(uploadDir, { recursive: true, force: true });
    rmSync(outputDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await tdb.truncate();
    enqueued.length = 0;
    mkdirSync(uploadDir, { recursive: true });
    await keys.createApiKey({
      name: 'a',
      scopes: ['upload', 'read', 'manage'],
      creatorAddress: OWNER,
      rawKey: RAW_KEY,
    });
  });

  async function create(size: number): Promise<{ uploadId: string; assetId: string }> {
    const res = await request(app)
      .post('/api/v1/uploads')
      .set(TUS)
      .set('Upload-Length', String(size))
      .set('Upload-Metadata', `title ${b64('status')},filetype ${b64('video/mp4')}`);
    expect(res.status).toBe(201);
    const uploadId = String(res.headers.location).split('/').pop()!;
    const [row] = await tdb.sql<{ video_asset_id: string }[]>`
      select video_asset_id from upload_sessions where id = ${uploadId}
    `;
    return { uploadId, assetId: row.video_asset_id };
  }

  const patch = (uploadId: string, offset: number, body: Buffer) =>
    request(app)
      .patch(`/api/v1/uploads/${uploadId}`)
      .set(TUS)
      .set('Upload-Offset', String(offset))
      .set('Content-Type', 'application/offset+octet-stream')
      .send(body);

  async function status(assetId: string): Promise<string | undefined> {
    const [row] = await tdb.sql<{ status: string }[]>`
      select status from video_assets where id = ${assetId}
    `;
    return row?.status;
  }

  async function deleted(assetId: string): Promise<boolean> {
    const [row] = await tdb.sql<{ deleted_at: Date | null }[]>`
      select deleted_at from video_assets where id = ${assetId}
    `;
    return !row || row.deleted_at !== null;
  }

  it('is created until bytes arrive, then uploading until the pipeline takes it', async () => {
    const data = randomBytes(64 * 1024);
    const { uploadId, assetId } = await create(data.length);
    expect(await status(assetId)).toBe('created');

    const first = await patch(uploadId, 0, data.subarray(0, 16 * 1024));
    expect(first.status).toBe(204);
    expect(await status(assetId)).toBe('uploading');

    const rest = await patch(uploadId, 16 * 1024, data.subarray(16 * 1024));
    expect(rest.status).toBe(204);
    // finished and queued; the transcode stage moves it to processing
    expect(enqueued).toEqual([`transcode:${assetId}`]);
    expect(await status(assetId)).toBe('uploading');
  });

  it('leaves an asset the pipeline already moved alone', async () => {
    const data = randomBytes(32 * 1024);
    const { uploadId, assetId } = await create(data.length);
    expect((await patch(uploadId, 0, data.subarray(0, 8 * 1024))).status).toBe(204);
    for (const later of ['processing', 'ready', 'failed'] as const) {
      await tdb.sql`update video_assets set status = ${later} where id = ${assetId}`;
      expect(await assets.markAssetUploading(uploadId)).toBe(false);
      expect(await status(assetId)).toBe(later);
    }
  });

  it('does not move a deleted asset or one whose session stopped receiving', async () => {
    const data = randomBytes(32 * 1024);
    const deleted = await create(data.length);
    await tdb.sql`update video_assets set deleted_at = now() where id = ${deleted.assetId}`;
    expect(await assets.markAssetUploading(deleted.uploadId)).toBe(false);
    expect(await status(deleted.assetId)).toBe('created');

    const stopped = await create(data.length);
    await tdb.sql`update upload_sessions set status = 'cancelled' where id = ${stopped.uploadId}`;
    expect(await assets.markAssetUploading(stopped.uploadId)).toBe(false);
    expect(await status(stopped.assetId)).toBe('created');
  });

  it('still discards the asset when an uploading transfer is cancelled', async () => {
    const data = randomBytes(32 * 1024);
    const { uploadId, assetId } = await create(data.length);
    expect((await patch(uploadId, 0, data.subarray(0, 8 * 1024))).status).toBe(204);
    expect(await status(assetId)).toBe('uploading');

    const cancel = await request(app).delete(`/api/v1/uploads/${uploadId}`).set(TUS);
    expect(cancel.status).toBe(204);
    expect(await deleted(assetId)).toBe(true);
    expect(enqueued).toEqual([`deletion:${assetId}`]);
  });

  it('still lets an expired uploading transfer remove its asset', async () => {
    const data = randomBytes(32 * 1024);
    const { uploadId, assetId } = await create(data.length);
    expect((await patch(uploadId, 0, data.subarray(0, 8 * 1024))).status).toBe(204);
    await tdb.sql`update upload_sessions set expires_at = now() - interval '1 minute' where id = ${uploadId}`;

    expect(await expireAbandonedUploads()).toBe(1);
    expect(await deleted(assetId)).toBe(true);
  });
});
