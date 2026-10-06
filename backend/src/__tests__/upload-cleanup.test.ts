import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// the real tus server and file store, writing to a temp UPLOAD_DIR
const dirs = await vi.hoisted(async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  return { root: fs.mkdtempSync(`${os.tmpdir()}/sluby-upload-cleanup-`) };
});

vi.mock('../config/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));
vi.mock('../config/env.js', () => ({
  env: {
    AUTH_DISABLED: true,
    SESSION_SECRET: 's'.repeat(40),
    UPLOAD_DIR: `${dirs.root}/uploads`,
    MAX_UPLOAD_SIZE: 1024 * 1024,
  },
}));

import { createTusServer, type TusServerDeps } from '../upload/tus-server.js';
import { sweepExpiredUploads, UPLOAD_EXPIRY_MS } from '../upload/upload-store.js';
import { removeSessionSource } from '../upload/source-files.js';
import { buildRetryAsset } from '../queue/retry.js';
import { logger } from '../config/logger.js';

const uploadDir = `${dirs.root}/uploads`;
const BASE = 'http://studio.test/api/v1/uploads';
const TUS = { 'Tus-Resumable': '1.0.0' };

interface World {
  sessions: Map<string, { filePath: string; status: string; videoAssetId: string }>;
  failedAssets: Set<string>;
  deps: TusServerDeps;
}
let w: World;
let nextAsset = 0;

function makeDeps(world: Omit<World, 'deps'>): TusServerDeps {
  return {
    validateApiKey: vi.fn(),
    createUploadSession: vi.fn(async (data) => {
      const id = `session-${++nextAsset}`;
      const videoAssetId = `asset-${nextAsset}`;
      world.sessions.set(id, { filePath: data.filePath, status: 'uploading', videoAssetId });
      return { id, videoAssetId };
    }),
    updateUploadProgress: vi.fn(async () => {}),
    completeUpload: vi.fn(async (sessionId, filePath) => {
      const s = world.sessions.get(sessionId)!;
      s.status = 'completed';
      s.filePath = filePath;
    }),
    cancelUpload: vi.fn(async () => {}),
    enqueueTranscoding: vi.fn(async () => {}),
    markAssetFailed: vi.fn(async (id) => {
      world.failedAssets.add(id);
    }),
    discardAsset: vi.fn(async () => {}),
    dispatchWebhook: vi.fn(async () => {}),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  rmSync(uploadDir, { recursive: true, force: true });
  mkdirSync(uploadDir, { recursive: true });
  const world = { sessions: new Map(), failedAssets: new Set<string>() };
  w = { ...world, deps: makeDeps(world) };
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  rmSync(dirs.root, { recursive: true, force: true });
});

async function create(server: ReturnType<typeof createTusServer>, size: number) {
  const res = await server.handleWeb(
    new Request(BASE, {
      method: 'POST',
      headers: { ...TUS, 'Upload-Length': String(size) },
    }),
  );
  expect(res.status).toBe(201);
  const location = res.headers.get('location')!;
  return { location, id: location.split('/').pop()! };
}

async function patch(server: ReturnType<typeof createTusServer>, location: string, body: string) {
  const res = await server.handleWeb(
    new Request(location, {
      method: 'PATCH',
      headers: {
        ...TUS,
        'Upload-Offset': '0',
        'Content-Type': 'application/offset+octet-stream',
      },
      body,
    }),
  );
  expect(res.status).toBe(204);
}

const onDisk = (id: string) => ({
  data: existsSync(path.join(uploadDir, id)),
  sidecar: existsSync(path.join(uploadDir, `${id}.json`)),
});

describe('tus upload files', () => {
  it('records where the upload lives when the session is created', async () => {
    const server = createTusServer(w.deps);
    const { id } = await create(server, 10);

    expect(w.deps.createUploadSession).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: `${uploadDir}/${id}` }),
    );
    expect(onDisk(id)).toEqual({ data: true, sidecar: true });
  });

  it('removes the data and the sidecar when the uploader terminates the upload', async () => {
    const server = createTusServer(w.deps);
    const { id, location } = await create(server, 10);
    await patch(server, location, 'hello');
    expect(onDisk(id)).toEqual({ data: true, sidecar: true });

    const res = await server.handleWeb(new Request(location, { method: 'DELETE', headers: TUS }));

    expect(res.status).toBe(204);
    expect(onDisk(id)).toEqual({ data: false, sidecar: false });
    expect(w.deps.cancelUpload).toHaveBeenCalledWith('session-' + nextAsset);
    expect(w.deps.discardAsset).toHaveBeenCalledWith('asset-' + nextAsset);
  });
});

describe('expired upload sweep', () => {
  it('removes an expired incomplete upload but keeps a completed one and a fresh one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = new Date('2026-01-01T00:00:00Z').getTime();
    vi.setSystemTime(t0);
    const server = createTusServer(w.deps);

    const done = await create(server, 5);
    await patch(server, done.location, 'video');
    const abandoned = await create(server, 10);
    await patch(server, abandoned.location, 'half');

    vi.setSystemTime(t0 + UPLOAD_EXPIRY_MS + 60_000);
    const fresh = await create(server, 10);

    const removed = await sweepExpiredUploads(server, logger);

    expect(removed).toBe(1);
    expect(onDisk(abandoned.id)).toEqual({ data: false, sidecar: false });
    expect(onDisk(done.id)).toEqual({ data: true, sidecar: true });
    expect(onDisk(fresh.id)).toEqual({ data: true, sidecar: true });
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ uploadId: abandoned.id, offset: 4, size: 10 }),
      'Removed expired incomplete upload',
    );
    expect(logger.info).toHaveBeenCalledWith({ removed: 1 }, 'Swept expired incomplete uploads');
  });

  it('does not remove an incomplete upload before it expires', async () => {
    const server = createTusServer(w.deps);
    const partial = await create(server, 10);
    await patch(server, partial.location, 'half');

    expect(await sweepExpiredUploads(server, logger)).toBe(0);
    expect(onDisk(partial.id)).toEqual({ data: true, sidecar: true });
  });

  it('logs a sweep failure instead of throwing it', async () => {
    const boom = new Error('disk gone');
    const failing = { cleanUpExpiredUploads: vi.fn().mockRejectedValue(boom) };

    await expect(sweepExpiredUploads(failing, logger)).resolves.toBe(0);
    expect(logger.error).toHaveBeenCalledWith({ err: boom }, 'Expired upload sweep failed');
  });
});

describe('source of a failed asset', () => {
  it('survives the expiry sweep, so a retry can transcode it again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const t0 = new Date('2026-01-01T00:00:00Z').getTime();
    vi.setSystemTime(t0);
    // the transcode enqueue fails, which marks the asset failed in onUploadFinish
    vi.mocked(w.deps.enqueueTranscoding).mockRejectedValueOnce(new Error('redis down'));
    const server = createTusServer(w.deps);

    const { id, location } = await create(server, 5);
    const res = await server.handleWeb(
      new Request(location, {
        method: 'PATCH',
        headers: {
          ...TUS,
          'Upload-Offset': '0',
          'Content-Type': 'application/offset+octet-stream',
        },
        body: 'video',
      }),
    );
    expect(res.status).toBe(500);
    const sessionId = `session-${nextAsset}`;
    const assetId = `asset-${nextAsset}`;
    expect(w.failedAssets.has(assetId)).toBe(true);

    vi.setSystemTime(t0 + 3 * UPLOAD_EXPIRY_MS);
    expect(await sweepExpiredUploads(server, logger)).toBe(0);
    expect(onDisk(id)).toEqual({ data: true, sidecar: true });

    const enqueueTranscode = vi.fn(async () => {});
    const retry = buildRetryAsset({
      getAsset: async (a) =>
        w.failedAssets.has(a) ? { id: a, status: 'failed', accessTier: 'public' } : undefined,
      getProcessingJob: async () => ({ id: 'job-1', uploadSessionId: sessionId }),
      getUploadSession: async (s) => w.sessions.get(s),
      markAssetProcessing: async () => {},
      markJobProcessing: async () => {},
      enqueueUploadSegments: async () => {},
      enqueueTranscode,
      transcodeOutputDir: path.join(dirs.root, 'transcode'),
    });

    await expect(retry(assetId)).resolves.toEqual({ stage: 'transcode' });
    expect(enqueueTranscode).toHaveBeenCalledWith(
      expect.objectContaining({ videoAssetId: assetId, filePath: `${uploadDir}/${id}` }),
      expect.any(String),
    );
  });
});

describe('source of a ready asset', () => {
  it('is removed with its sidecar once finalize has marked the asset ready', async () => {
    const server = createTusServer(w.deps);
    const { id, location } = await create(server, 5);
    await patch(server, location, 'video');
    const sessionId = `session-${nextAsset}`;
    expect(w.sessions.get(sessionId)!.status).toBe('completed');

    await removeSessionSource(
      sessionId,
      { getUploadSession: async (s) => w.sessions.get(s), log: logger },
      { videoAssetId: `asset-${nextAsset}` },
    );

    expect(onDisk(id)).toEqual({ data: false, sidecar: false });
    expect(readdirSync(uploadDir)).toEqual([]);
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: `${uploadDir}/${id}`, uploadSessionId: sessionId }),
      'Removed source upload',
    );
  });

  it('logs a failed session lookup instead of failing finalize', async () => {
    const boom = new Error('db down');

    await expect(
      removeSessionSource('session-x', {
        getUploadSession: async () => {
          throw boom;
        },
        log: logger,
      }),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ uploadSessionId: 'session-x', err: boom }),
      'Could not look up the source upload to remove it',
    );
  });

  it('logs a file it can not remove, with its path, instead of failing finalize', async () => {
    // a non-empty directory where the upload should be makes rm fail for real
    const stuck = path.join(uploadDir, 'stuck');
    mkdirSync(stuck);
    mkdirSync(path.join(stuck, 'inner'));

    await expect(
      removeSessionSource('session-y', {
        getUploadSession: async () => ({ filePath: stuck }),
        log: logger,
      }),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ path: stuck, err: expect.any(Error) }),
      'Failed to remove source upload file',
    );
  });
});
