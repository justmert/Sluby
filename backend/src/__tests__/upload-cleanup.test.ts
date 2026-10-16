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
    PUBLIC_URL: 'http://studio.test',
  },
}));

import { createTusServer, type TusServerDeps } from '../upload/tus-server.js';
import { sweepExpiredUploads, UPLOAD_EXPIRY_MS } from '../upload/upload-store.js';
import {
  removeAssetSources,
  removeSessionSource,
  sweepFinishedSources,
} from '../upload/source-files.js';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { SessionManager } from '../upload/session-manager.js';
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
    callers: {
      findActiveSession: vi.fn(async () => undefined),
      findApiKeyByHash: vi.fn(async () => null),
      getAccount: vi.fn(async () => null),
      findLegacyClaim: vi.fn(async () => null),
      isAllowlistEntryPinned: vi.fn(async () => false),
      localDevAccount: vi.fn(async () => ({
        userId: '00000000-0000-4000-8000-0000000000de',
        username: 'dev',
        displayName: 'Local developer',
      })),
    },
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
    abandonUpload: vi.fn(async () => {}),
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
    // wired like index.ts: the session is cancelled without touching the files,
    // and the asset deletion removes the sources of sessions that are not
    // cancelled (listUploadFilePaths). it runs here before tus's own removal,
    // the worst case of the race with the deletion worker
    const sessions = new SessionManager({
      insertSession: async () => {},
      getSession: async (id) => {
        const s = w.sessions.get(id);
        return s
          ? {
              id,
              videoAssetId: s.videoAssetId,
              uploadUrl: '',
              filePath: s.filePath,
              fileSize: 10,
              uploadedBytes: 0,
              sha256Hash: null,
              status: s.status as 'uploading',
              metadata: {},
              createdAt: new Date(),
              updatedAt: new Date(),
              expiresAt: new Date(),
            }
          : null;
      },
      updateSession: async (id, data) => {
        if (data.status) w.sessions.get(id)!.status = data.status;
      },
    });
    w.deps.cancelUpload = async (id) => {
      await sessions.cancel(id, undefined, { removeFiles: false });
    };
    w.deps.discardAsset = (assetId) =>
      removeAssetSources(assetId, {
        listSourcePaths: async (a) =>
          [...w.sessions.values()]
            .filter((s) => s.videoAssetId === a && s.status !== 'cancelled')
            .map((s) => s.filePath),
        log: logger,
      });
    const server = createTusServer(w.deps);
    const { id, location } = await create(server, 10);
    await patch(server, location, 'hello');
    expect(onDisk(id)).toEqual({ data: true, sidecar: true });

    const res = await server.handleWeb(new Request(location, { method: 'DELETE', headers: TUS }));

    expect(res.status).toBe(204);
    expect(onDisk(id)).toEqual({ data: false, sidecar: false });
    expect(w.sessions.get(`session-${nextAsset}`)!.status).toBe('cancelled');
  });

  it('answers 404 on the next request once the asset of an upload in flight is deleted', async () => {
    const server = createTusServer(w.deps);
    const { id, location } = await create(server, 10);
    await patch(server, location, 'hello');

    // what the deletion worker does for an asset whose upload is still running
    await removeAssetSources(`asset-${nextAsset}`, {
      listSourcePaths: async () => [`${uploadDir}/${id}`],
      log: logger,
    });

    expect(onDisk(id)).toEqual({ data: false, sidecar: false });
    const head = await server.handleWeb(new Request(location, { method: 'HEAD', headers: TUS }));
    expect(head.status).toBe(404);
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

const silentLog = () => ({ info: vi.fn(), error: vi.fn() });

describe('sweepFinishedSources', () => {
  it('removes sources of ready and deleted assets and leaves the rest', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sluby-sweep-'));
    try {
      const names = ['ready', 'gone', 'failed', 'cancelled', 'unknown'];
      for (const n of names) {
        await writeFile(path.join(dir, n), 'data');
        await writeFile(path.join(dir, `${n}.json`), '{}');
      }
      const states = new Map<string, 'ready' | 'gone' | 'in-use' | 'cancelled'>([
        [`${dir}/ready`, 'ready'],
        [`${dir}/gone`, 'gone'],
        [`${dir}/failed`, 'in-use'],
        [`${dir}/cancelled`, 'cancelled'],
      ]);
      const asked: string[][] = [];
      const stillOnDisk: string[][] = [];
      const result = await sweepFinishedSources({
        uploadDir: dir,
        states: async (paths) => {
          asked.push(paths);
          return states;
        },
        forgetDetached: async (paths) => {
          stillOnDisk.push(paths);
          return 4;
        },
        log: silentLog(),
      });
      expect(result).toEqual({ removed: 2, unknown: 1, forgotten: 4 });
      // the sessions of deleted assets go once their files are gone, so the
      // ones removed just now are not in the list of files still there
      expect(stillOnDisk[0].sort()).toEqual(
        ['cancelled', 'failed', 'unknown'].map((n) => `${dir}/${n}`).sort(),
      );
      // only data files are looked up, never the json sidecars
      expect(asked[0].sort()).toEqual(names.map((n) => `${dir}/${n}`).sort());
      expect((await readdir(dir)).sort()).toEqual(
        ['cancelled', 'cancelled.json', 'failed', 'failed.json', 'unknown', 'unknown.json'].sort(),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('removes nothing when the lookup fails', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sluby-sweep-'));
    try {
      await writeFile(path.join(dir, 'a'), 'data');
      const log = silentLog();
      const result = await sweepFinishedSources({
        uploadDir: dir,
        states: async () => {
          throw new Error('db down');
        },
        forgetDetached: vi.fn(),
        log,
      });
      expect(result).toEqual({ removed: 0, unknown: 0, forgotten: 0 });
      expect(await readdir(dir)).toEqual(['a']);
      expect(log.error).toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('forgets no session when the upload directory cannot be listed', async () => {
    const forgetDetached = vi.fn();
    const log = silentLog();
    const result = await sweepFinishedSources({
      uploadDir: path.join(tmpdir(), 'sluby-sweep-missing-dir'),
      states: async () => new Map(),
      forgetDetached,
      log,
    });
    expect(result).toEqual({ removed: 0, unknown: 0, forgotten: 0 });
    // with no listing, every session would look like its file is gone
    expect(forgetDetached).not.toHaveBeenCalled();
  });

  it('logs and carries on when forgetting sessions fails', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'sluby-sweep-'));
    try {
      const log = silentLog();
      const result = await sweepFinishedSources({
        uploadDir: dir,
        states: async () => new Map(),
        forgetDetached: async () => {
          throw new Error('db down');
        },
        log,
      });
      expect(result).toEqual({ removed: 0, unknown: 0, forgotten: 0 });
      expect(log.error).toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
