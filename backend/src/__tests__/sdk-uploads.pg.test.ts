/**
 * The sdk's upload calls against the real backend: @sluby/sdk from source,
 * tus-js-client on real sockets, and the shipped app.ts (tus server, REST
 * upload routes, adapters, queries) over a real Postgres database. Queues and
 * the webhook dispatcher are in-memory stand-ins, as in the contract test.
 * What this pins down is that the id an upload handle hands out is the one
 * GET and DELETE /api/v1/uploads/{id} take.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import { hasTestDatabase, createTestDatabase, type TestDatabase } from './helpers/pg.js';
import type * as AppModule from '../app.js';
import type * as KeyQueries from '../db/queries/api-keys.js';

const OWNER = 'github:alice';
const RAW_KEY = `sluby_${'a'.repeat(40)}`;

// the sdk is loaded from its source at run time: the backend's tsconfig keeps
// rootDir at src, so a static import of another package's source would not
// compile. these are the parts of its surface the tests use.
interface SdkUploadHandle extends Promise<void> {
  pause: () => Promise<void>;
  readonly isPaused: boolean;
  assetId: Promise<string>;
  uploadId: Promise<string>;
}
interface SdkUploadSession {
  id: string;
  videoAssetId: string | null;
  status: string;
  progressPercent: number;
  fileSize: number;
  uploadedBytes: number;
}
interface SdkClient {
  uploads: {
    upload: (
      file: Blob,
      options: {
        title: string;
        chunkSize?: number;
        onProgress?: (percent: number, sent: number, total: number) => void;
      },
    ) => SdkUploadHandle;
    getStatus: (uploadId: string) => Promise<SdkUploadSession>;
    cancel: (uploadId: string) => Promise<void>;
  };
  assets: { get: (id: string) => Promise<{ id: string; status: string }> };
}
interface SdkModule {
  SlubyClient: new (config: { apiKey: string; baseUrl: string }) => SdkClient;
  NotFoundError: new (...args: never[]) => Error;
  ConflictError: new (...args: never[]) => Error;
}
const SDK_ENTRY = new URL('../../../packages/sdk/src/index.ts', import.meta.url).href;

/** Resolve once `predicate` holds, polling the event loop. */
async function until(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe.skipIf(!hasTestDatabase)('sdk uploads against the backend (postgres)', () => {
  let tdb: TestDatabase;
  let server: http.Server;
  let sdk: SdkModule;
  let client: SdkClient;
  let keys: typeof KeyQueries;
  let closeDatabase: () => Promise<void>;
  let uploadDir: string;
  let outputDir: string;

  const fakeQueue = () => ({
    add: async () => {},
    getJobCounts: async () => ({ waiting: 0, active: 0, delayed: 0 }),
  });

  beforeAll(async () => {
    // the tus upload url is built from PUBLIC_URL, so the server has to be
    // listening before the env is read
    server = http.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    uploadDir = mkdtempSync(path.join(os.tmpdir(), 'sluby-sdk-up-'));
    outputDir = mkdtempSync(path.join(os.tmpdir(), 'sluby-sdk-out-'));
    process.env.UPLOAD_DIR = uploadDir;
    process.env.TRANSCODE_OUTPUT_DIR = outputDir;
    process.env.PUBLIC_URL = baseUrl;
    process.env.AUTH_DISABLED = 'false';
    process.env.SIA_INDEXER_URL = 'http://127.0.0.1:9';

    tdb = await createTestDatabase();
    const appModule: typeof AppModule = await import('../app.js');
    keys = await import('../db/queries/api-keys.js');
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
      webhookDispatcher: { dispatch: async () => {} },
      triggerReconciliation: async () => ({ enqueued: true }),
    });
    server.on('request', app);
    client = new sdk.SlubyClient({ apiKey: RAW_KEY, baseUrl });
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
    mkdirSync(uploadDir, { recursive: true });
    await keys.createApiKey({
      name: 'sdk',
      scopes: ['upload', 'read', 'manage'],
      creatorAddress: OWNER,
      rawKey: RAW_KEY,
    });
  });

  const video = (bytes: number) => new Blob([randomBytes(bytes)], { type: 'video/mp4' });

  it('reads the status of a paused upload by the handle id, then cancels it', async () => {
    const file = video(256 * 1024);
    let paused = false;
    const upload = client.uploads.upload(file, {
      title: 'paused',
      chunkSize: 32 * 1024,
      onProgress: (_pct, sent) => {
        if (!paused && sent >= 64 * 1024) {
          paused = true;
          void upload.pause();
        }
      },
    });
    // a cancelled upload rejects the handle; the test asserts on the server side
    upload.catch(() => {});

    const uploadId = await upload.uploadId;
    const assetId = await upload.assetId;
    await until(() => upload.isPaused);
    // let a PATCH already in flight land
    await new Promise((r) => setTimeout(r, 100));

    const status = await client.uploads.getStatus(uploadId);
    expect(status.id).toBe(uploadId);
    expect(status.videoAssetId).toBe(assetId);
    expect(status.status).toBe('uploading');
    expect(status.fileSize).toBe(file.size);
    expect(status.uploadedBytes).toBeGreaterThan(0);
    expect(status.uploadedBytes).toBeLessThan(file.size);
    expect(status.progressPercent).toBe(Math.round((status.uploadedBytes / file.size) * 100));

    await client.uploads.cancel(uploadId);
    const cancelled = await client.uploads.getStatus(uploadId);
    expect(cancelled.status).toBe('cancelled');
    // the asset the upload created goes with it
    await expect(client.assets.get(assetId)).rejects.toBeInstanceOf(sdk.NotFoundError);
  });

  it('reports a finished upload as completed and refuses to cancel it', async () => {
    const file = video(96 * 1024);
    const upload = client.uploads.upload(file, { title: 'finished', chunkSize: 32 * 1024 });
    const uploadId = await upload.uploadId;
    const assetId = await upload.assetId;
    await upload;

    const status = await client.uploads.getStatus(uploadId);
    expect(status).toMatchObject({
      id: uploadId,
      videoAssetId: assetId,
      status: 'completed',
      fileSize: file.size,
    });

    await expect(client.uploads.cancel(uploadId)).rejects.toBeInstanceOf(sdk.ConflictError);
    // the asset stays
    expect((await client.assets.get(assetId)).id).toBe(assetId);
  });

  it('answers NotFoundError for an id no upload has', async () => {
    await expect(
      client.uploads.getStatus('00000000-0000-4000-8000-000000000000'),
    ).rejects.toBeInstanceOf(sdk.NotFoundError);
  });
});
