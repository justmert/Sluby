import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildRetryAsset, type RetryAssetDeps } from '../queue/retry.js';
import { findCompletedOutput, writeCompletionMarker } from '../queue/output-dirs.js';
import { createAssetRoutes, type AssetRouteDeps } from '../api/routes/assets.js';
import { createTestApp, withApiKey } from './helpers/express-helpers.js';

interface World {
  root: string;
  outputRoot: string;
  assets: Map<string, { id: string; status: string; accessTier: string; owner: string }>;
  jobs: Map<string, { id: string; status: string; retries: number }>;
  sessions: Map<string, { id: string; filePath: string }>;
  uploadQueue: Array<{ data: unknown; jobId: string }>;
  transcodeQueue: Array<{ data: unknown; jobId: string }>;
}

let w: World;

beforeEach(() => {
  const root = mkdtempSync(path.join(tmpdir(), 'sluby-retry-'));
  w = {
    root,
    outputRoot: path.join(root, 'transcode'),
    assets: new Map(),
    jobs: new Map(),
    sessions: new Map(),
    uploadQueue: [],
    transcodeQueue: [],
  };
  mkdirSync(w.outputRoot);
});

afterEach(() => {
  rmSync(w.root, { recursive: true, force: true });
});

const A1 = '11111111-1111-4111-8111-111111111111';

// in-memory stand-ins for the database rows and the two queues; the unit
// under test reads and writes them the way app.ts wires the real ones. The
// claim is a check and a write in one synchronous step, as the single UPDATE
// is in postgres
function deps(): RetryAssetDeps {
  return {
    getAsset: async (id, owner) => {
      const a = w.assets.get(id);
      if (!a || (owner !== undefined && a.owner !== owner)) return undefined;
      return { ...a };
    },
    getProcessingJob: async (assetId) => w.jobs.get(assetId),
    createProcessingJob: async (assetId) => {
      const job = { id: `job-${assetId}`, status: 'queued', retries: 0 };
      w.jobs.set(assetId, job);
      return job;
    },
    getUploadSession: async (assetId) => w.sessions.get(assetId),
    findCompletedOutput: (assetId) => findCompletedOutput(w.outputRoot, assetId),
    claimFailedAsset: async (id, owner) => {
      const a = w.assets.get(id);
      if (!a || a.status !== 'failed' || (owner !== undefined && a.owner !== owner)) return false;
      a.status = 'processing';
      return true;
    },
    releaseClaim: async (id) => {
      const a = w.assets.get(id);
      if (a?.status === 'processing') a.status = 'failed';
    },
    restartJob: async (jobId) => {
      for (const j of w.jobs.values()) {
        if (j.id === jobId) {
          j.status = 'queued';
          j.retries++;
        }
      }
    },
    enqueueUploadSegments: async (data, jobId) => {
      w.uploadQueue.push({ data, jobId });
    },
    enqueueTranscode: async (data, jobId) => {
      w.transcodeQueue.push({ data, jobId });
    },
    now: () => 1700000000000,
  };
}

function failedAsset(id = A1, owner = 'acct') {
  w.assets.set(id, { id, status: 'failed', accessTier: 'private', owner });
  w.jobs.set(id, { id: `job-${id}`, status: 'failed', retries: 0 });
}

/** A run directory as FFmpeg left it; `finished` adds the completion marker. */
async function writeTranscodeOutput(id: string, opts: { finished: boolean; thumbs?: number[] }) {
  const dir = path.join(w.outputRoot, id, `run-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  // a header-only master is what FFmpeg writes on some failures
  writeFileSync(path.join(dir, 'master.m3u8'), '#EXTM3U\n#EXT-X-VERSION:7\n');
  const thumbs = (opts.thumbs ?? []).map((t) => `thumb_${t}.jpg`);
  for (const t of thumbs) writeFileSync(path.join(dir, t), 'jpg');
  if (opts.finished) {
    await writeCompletionMarker(dir, {
      durationMs: 4000,
      resolution: '640x360',
      thumbnails: thumbs,
    });
  }
  return dir;
}

function writeSource(id: string): string {
  const file = path.join(w.root, `${id}-source.mp4`);
  writeFileSync(file, 'video');
  w.sessions.set(id, { id: `up-${id}`, filePath: file });
  return file;
}

describe('buildRetryAsset', () => {
  it('resumes at the upload stage when a finished transcode is on disk', async () => {
    failedAsset();
    const dir = await writeTranscodeOutput(A1, { finished: true, thumbs: [25, 75] });
    writeSource(A1);

    const result = await buildRetryAsset(deps())(A1, 'acct');

    expect(result).toEqual({ stage: 'upload-segments' });
    expect(w.uploadQueue).toEqual([
      {
        data: {
          videoAssetId: A1,
          uploadSessionId: `up-${A1}`,
          outputDir: dir,
          accessTier: 'private',
          thumbnailPaths: [path.join(dir, 'thumb_25.jpg'), path.join(dir, 'thumb_75.jpg')],
          durationMs: 4000,
          resolution: '640x360',
          startsRun: true,
          runId: 'retry-1700000000000',
        },
        jobId: `upload-${A1}-retry-1700000000000`,
      },
    ]);
    expect(w.transcodeQueue).toEqual([]);
    expect(w.assets.get(A1)!.status).toBe('processing');
    expect(w.jobs.get(A1)).toMatchObject({ status: 'queued', retries: 1 });
  });

  it('transcodes again when the output on disk never finished, however complete it looks', async () => {
    failedAsset();
    await writeTranscodeOutput(A1, { finished: false });
    const source = writeSource(A1);

    expect(await buildRetryAsset(deps())(A1, 'acct')).toEqual({ stage: 'transcode' });
    expect(w.uploadQueue).toEqual([]);
    expect(w.transcodeQueue).toEqual([
      {
        data: {
          videoAssetId: A1,
          uploadSessionId: `up-${A1}`,
          filePath: source,
          runId: 'retry-1700000000000',
        },
        jobId: `transcode-${A1}-retry-1700000000000`,
      },
    ]);
  });

  it('transcodes again from the uploaded source when there is no output', async () => {
    failedAsset();
    writeSource(A1);
    expect(await buildRetryAsset(deps())(A1, 'acct')).toEqual({ stage: 'transcode' });
    expect(w.assets.get(A1)!.status).toBe('processing');
  });

  it('answers 410 and changes nothing when the source file is gone', async () => {
    failedAsset();
    w.sessions.set(A1, { id: `up-${A1}`, filePath: path.join(w.root, 'deleted.mp4') });

    await expect(buildRetryAsset(deps())(A1, 'acct')).rejects.toMatchObject({
      statusCode: 410,
      message: 'Source file not found, please re-upload the video',
    });
    expect(w.assets.get(A1)!.status).toBe('failed');
    expect(w.jobs.get(A1)!.status).toBe('failed');
    expect(w.transcodeQueue).toEqual([]);
  });

  it('finds the source through the upload session when the asset has no processing job', async () => {
    failedAsset();
    w.jobs.delete(A1);
    writeSource(A1);

    expect(await buildRetryAsset(deps())(A1, 'acct')).toEqual({ stage: 'transcode' });
    expect(w.transcodeQueue[0].data).toMatchObject({ uploadSessionId: `up-${A1}` });
    // a job row now exists for the stages to log to
    expect(w.jobs.get(A1)).toMatchObject({ id: `job-${A1}` });
  });

  it('starts one run when two retries arrive at once', async () => {
    failedAsset();
    writeSource(A1);
    const retry = buildRetryAsset(deps());

    const results = await Promise.allSettled([retry(A1, 'acct'), retry(A1, 'acct')]);

    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ statusCode: 400 });
    expect(w.transcodeQueue).toHaveLength(1);
  });

  it('leaves the asset retryable when the job cannot be queued', async () => {
    failedAsset();
    writeSource(A1);
    const failing = {
      ...deps(),
      enqueueTranscode: async () => Promise.reject(new Error('redis down')),
    };

    await expect(buildRetryAsset(failing)(A1, 'acct')).rejects.toThrow('redis down');
    expect(w.assets.get(A1)!.status).toBe('failed');
    expect(await buildRetryAsset(deps())(A1, 'acct')).toEqual({ stage: 'transcode' });
  });

  it('answers 400 for an asset that has not failed', async () => {
    failedAsset();
    w.assets.get(A1)!.status = 'ready';
    await writeTranscodeOutput(A1, { finished: true });

    await expect(buildRetryAsset(deps())(A1, 'acct')).rejects.toMatchObject({
      statusCode: 400,
      message: 'Asset is not in failed state',
    });
    expect(w.uploadQueue).toEqual([]);
  });

  it("answers 404 for another account's asset", async () => {
    failedAsset(A1, 'someone-else');
    await writeTranscodeOutput(A1, { finished: true });

    await expect(buildRetryAsset(deps())(A1, 'acct')).rejects.toMatchObject({
      statusCode: 404,
      message: 'Video asset not found',
    });
    expect(w.uploadQueue).toEqual([]);
  });
});

describe('POST /assets/:id/retry through the real error handler', () => {
  function app(creatorAddress = 'acct') {
    const routeDeps = new Proxy(
      { retryAsset: buildRetryAsset(deps()) },
      {
        get(target, prop) {
          if (prop in target) return target[prop as keyof typeof target];
          throw new Error(`unexpected dependency ${String(prop)}`);
        },
      },
    ) as unknown as AssetRouteDeps;
    return withApiKey(createTestApp(createAssetRoutes(routeDeps)), {
      id: 'k',
      name: 'k',
      scopes: ['read', 'upload', 'manage'],
      rateLimit: 100,
      creatorAddress,
    });
  }

  it('answers with the stage it queued', async () => {
    failedAsset();
    writeSource(A1);
    const res = await request(app()).post(`/${A1}/retry`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, stage: 'transcode' });
  });

  it.each([
    ['missing', () => {}, 404, 'Video asset not found'],
    [
      'not failed',
      () => {
        failedAsset();
        w.assets.get(A1)!.status = 'processing';
      },
      400,
      'Asset is not in failed state',
    ],
    [
      'without its source',
      () => failedAsset(),
      410,
      'Source file not found, please re-upload the video',
    ],
  ])('maps a %s asset to %i', async (_label, setup, status, message) => {
    setup();
    const res = await request(app()).post(`/${A1}/retry`);
    expect(res.status).toBe(status);
    expect(res.body.error).toBe(message);
  });

  it('scopes the retry to the caller', async () => {
    failedAsset(A1, 'acct');
    writeSource(A1);
    const res = await request(app('intruder')).post(`/${A1}/retry`);
    expect(res.status).toBe(404);
    expect(w.transcodeQueue).toEqual([]);
  });
});
