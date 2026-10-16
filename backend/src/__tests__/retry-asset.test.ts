import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildRetryAsset, type RetryAssetDeps } from '../queue/retry.js';
import { createAssetRoutes, type AssetRouteDeps } from '../api/routes/assets.js';
import { createTestApp, withApiKey } from './helpers/express-helpers.js';

interface World {
  root: string;
  outputRoot: string;
  assets: Map<string, { id: string; status: string; accessTier: string; owner: string }>;
  jobs: Map<string, { id: string; uploadSessionId: string; status: string }>;
  sessions: Map<string, { filePath: string }>;
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

// in-memory stand-ins for the database rows and the two queues; the unit
// under test reads and writes them the way index.ts wires the real ones
function deps(): RetryAssetDeps {
  return {
    getAsset: async (id, owner) => {
      const a = w.assets.get(id);
      if (!a || (owner !== undefined && a.owner !== owner)) return undefined;
      return a;
    },
    getProcessingJob: async (assetId) => w.jobs.get(assetId),
    getUploadSession: async (id) => w.sessions.get(id),
    markAssetProcessing: async (id) => {
      w.assets.get(id)!.status = 'processing';
    },
    markJobProcessing: async (jobId) => {
      for (const j of w.jobs.values()) if (j.id === jobId) j.status = 'processing';
    },
    enqueueUploadSegments: async (data, jobId) => {
      w.uploadQueue.push({ data, jobId });
    },
    enqueueTranscode: async (data, jobId) => {
      w.transcodeQueue.push({ data, jobId });
    },
    transcodeOutputDir: w.outputRoot,
    now: () => 1700000000000,
  };
}

function failedAsset(id = 'a1', owner = 'acct') {
  w.assets.set(id, { id, status: 'failed', accessTier: 'private', owner });
  w.jobs.set(id, { id: `job-${id}`, uploadSessionId: `up-${id}`, status: 'failed' });
}

function writeTranscodeOutput(id: string, thumbs: number[] = []) {
  const dir = path.join(w.outputRoot, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'master.m3u8'), '#EXTM3U\n');
  for (const t of thumbs) writeFileSync(path.join(dir, `thumb_${t}.jpg`), 'jpg');
}

function writeSource(id: string): string {
  const file = path.join(w.root, `${id}-source.mp4`);
  writeFileSync(file, 'video');
  w.sessions.set(`up-${id}`, { filePath: file });
  return file;
}

describe('buildRetryAsset', () => {
  it('resumes at the upload stage when the transcode output is still on disk', async () => {
    failedAsset();
    writeTranscodeOutput('a1', [25, 75]);

    const result = await buildRetryAsset(deps())('a1', 'acct');

    expect(result).toEqual({ stage: 'upload-segments' });
    expect(w.uploadQueue).toEqual([
      {
        data: {
          videoAssetId: 'a1',
          uploadSessionId: 'up-a1',
          outputDir: path.join(w.outputRoot, 'a1'),
          accessTier: 'private',
          // only the thumbnails that survived, in position order
          thumbnailPaths: [
            path.join(w.outputRoot, 'a1', 'thumb_25.jpg'),
            path.join(w.outputRoot, 'a1', 'thumb_75.jpg'),
          ],
        },
        jobId: 'retry-upload-a1-1700000000000',
      },
    ]);
    expect(w.transcodeQueue).toEqual([]);
    expect(w.assets.get('a1')!.status).toBe('processing');
    expect(w.jobs.get('a1')!.status).toBe('processing');
  });

  it('prefers resuming the upload even when the source is also still there', async () => {
    failedAsset();
    writeTranscodeOutput('a1');
    writeSource('a1');

    expect(await buildRetryAsset(deps())('a1', 'acct')).toEqual({ stage: 'upload-segments' });
    expect(w.transcodeQueue).toEqual([]);
  });

  it('transcodes again from the uploaded source when there is no output', async () => {
    failedAsset();
    const source = writeSource('a1');

    const result = await buildRetryAsset(deps())('a1', 'acct');

    expect(result).toEqual({ stage: 'transcode' });
    expect(w.transcodeQueue).toEqual([
      {
        data: { videoAssetId: 'a1', uploadSessionId: 'up-a1', filePath: source },
        jobId: 'retry-transcode-a1-1700000000000',
      },
    ]);
    expect(w.uploadQueue).toEqual([]);
    expect(w.assets.get('a1')!.status).toBe('processing');
    expect(w.jobs.get('a1')!.status).toBe('processing');
  });

  it('answers 410 and changes nothing when the source file is gone', async () => {
    failedAsset();
    w.sessions.set('up-a1', { filePath: path.join(w.root, 'deleted.mp4') });

    await expect(buildRetryAsset(deps())('a1', 'acct')).rejects.toMatchObject({
      statusCode: 410,
      message: 'Source file not found, please re-upload the video',
    });
    expect(w.assets.get('a1')!.status).toBe('failed');
    expect(w.jobs.get('a1')!.status).toBe('failed');
    expect(w.transcodeQueue).toEqual([]);
  });

  it('answers 410 when the asset has no processing job to find the upload by', async () => {
    failedAsset();
    w.jobs.delete('a1');
    await expect(buildRetryAsset(deps())('a1', 'acct')).rejects.toMatchObject({ statusCode: 410 });
  });

  it('still resumes the upload for an asset without a processing job row', async () => {
    failedAsset();
    w.jobs.delete('a1');
    writeTranscodeOutput('a1');

    expect(await buildRetryAsset(deps())('a1', 'acct')).toEqual({ stage: 'upload-segments' });
    expect(w.uploadQueue[0].data).toMatchObject({ uploadSessionId: '' });
    expect(w.assets.get('a1')!.status).toBe('processing');
  });

  it('answers 400 for an asset that has not failed', async () => {
    failedAsset();
    w.assets.get('a1')!.status = 'ready';
    writeTranscodeOutput('a1');

    await expect(buildRetryAsset(deps())('a1', 'acct')).rejects.toMatchObject({
      statusCode: 400,
      message: 'Asset is not in failed state',
    });
    expect(w.uploadQueue).toEqual([]);
  });

  it("answers 404 for another account's asset", async () => {
    failedAsset('a1', 'someone-else');
    writeTranscodeOutput('a1');

    await expect(buildRetryAsset(deps())('a1', 'acct')).rejects.toMatchObject({
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
    writeSource('a1');
    const res = await request(app()).post('/a1/retry');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, stage: 'transcode' });
  });

  it.each([
    ['missing', () => {}, 404, 'Video asset not found'],
    [
      'not failed',
      () => {
        failedAsset();
        w.assets.get('a1')!.status = 'processing';
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
    const res = await request(app()).post('/a1/retry');
    expect(res.status).toBe(status);
    expect(res.body.error).toBe(message);
  });

  it('scopes the retry to the caller', async () => {
    failedAsset('a1', 'acct');
    writeSource('a1');
    const res = await request(app('intruder')).post('/a1/retry');
    expect(res.status).toBe(404);
    expect(w.transcodeQueue).toEqual([]);
  });
});
