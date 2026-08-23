import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as tus from 'tus-js-client';
import { UploadManager } from './uploads.js';
import type { FetchFn } from './uploads.js';

// Fake tus Upload capturing options + exposing spy control methods, so we can
// drive the creation response, progress, success/error, and pause/resume.
vi.mock('tus-js-client', () => {
  class Upload {
    static instances: Upload[] = [];
    options: Record<string, (...args: unknown[]) => unknown>;
    start = vi.fn();
    abort = vi.fn<(shouldTerminate?: boolean) => Promise<void>>().mockResolvedValue(undefined);
    findPreviousUploads = vi.fn().mockResolvedValue([]);
    resumeFromPreviousUpload = vi.fn();
    constructor(_file: unknown, options: Record<string, (...args: unknown[]) => unknown>) {
      this.options = options;
      Upload.instances.push(this);
    }
  }
  return { Upload };
});

function lastUpload() {
  const instances = (tus as unknown as { Upload: { instances: unknown[] } }).Upload.instances;
  return instances[instances.length - 1] as {
    options: Record<string, (...args: unknown[]) => unknown>;
    start: ReturnType<typeof vi.fn>;
    abort: ReturnType<typeof vi.fn>;
  };
}

function metadataHeader(videoAssetId: string): string {
  const b64 =
    typeof btoa === 'function'
      ? btoa(videoAssetId)
      : Buffer.from(videoAssetId, 'utf8').toString('base64');
  return `videoAssetId ${b64},filename ${Buffer.from('v.mp4').toString('base64')}`;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

let mockFetch: ReturnType<typeof vi.fn<FetchFn>>;

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

beforeEach(() => {
  mockFetch = vi.fn<FetchFn>();
  (tus as unknown as { Upload: { instances: unknown[] } }).Upload.instances = [];
});

describe('UploadManager.upload()', () => {
  const make = () => new UploadManager(mockFetch, 'sluby_key', 'https://api.test');

  it('drives TUS at the collection endpoint with metadata and auth', async () => {
    const handle = make().upload(Buffer.from('data'), {
      title: 'My Video',
      description: 'desc',
      accessTier: 'private',
    });
    await flush();

    const up = lastUpload();
    expect(up.options.endpoint).toBe('https://api.test/api/v1/uploads');
    expect(up.options.headers).toMatchObject({ Authorization: 'Bearer sluby_key' });
    expect(up.options.metadata).toMatchObject({
      title: 'My Video',
      description: 'desc',
      accessTier: 'private',
    });
    // Single stream only — parallelUploads would mint multiple assets.
    expect(up.options.parallelUploads).toBeUndefined();
    expect(up.start).toHaveBeenCalledTimes(1);

    (up.options.onSuccess as () => void)();
    await handle;
  });

  it('resolves assetId from the Upload-Metadata creation response header', async () => {
    const handle = make().upload(Buffer.from('data'), { title: 'T' });
    await flush();
    const up = lastUpload();

    (up.options.onAfterResponse as (req: unknown, res: unknown) => void)(
      {},
      {
        getHeader: (name: string) =>
          name === 'Upload-Metadata' ? metadataHeader('asset-9') : undefined,
      },
    );

    await expect(handle.assetId).resolves.toBe('asset-9');

    (up.options.onSuccess as () => void)();
    await handle;
  });

  it('reports progress as percent plus raw bytes, and resolves on success', async () => {
    const onProgress = vi.fn();
    const onSuccess = vi.fn();
    const handle = make().upload(Buffer.from('data'), { title: 'T', onProgress, onSuccess });
    await flush();
    const up = lastUpload();

    (up.options.onProgress as (a: number, b: number) => void)(50, 200);
    expect(onProgress).toHaveBeenCalledWith(25, 50, 200);

    (up.options.onSuccess as () => void)();
    await expect(handle).resolves.toBeUndefined();
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('rejects the handle and assetId on unrecoverable error', async () => {
    const handle = make().upload(Buffer.from('data'), { title: 'T' });
    await flush();
    const up = lastUpload();

    const boom = new Error('network down');
    (up.options.onError as (e: Error) => void)(boom);

    await expect(handle).rejects.toThrow('network down');
    await expect(handle.assetId).rejects.toThrow('network down');
  });

  it('supports pause / resume / abort', async () => {
    const handle = make().upload(Buffer.from('data'), { title: 'T' });
    await flush();
    const up = lastUpload();

    expect(handle.isPaused).toBe(false);
    await handle.pause();
    expect(up.abort).toHaveBeenCalledWith(false);
    expect(handle.isPaused).toBe(true);

    handle.resume();
    expect(handle.isPaused).toBe(false);
    expect(up.start).toHaveBeenCalledTimes(2);

    await handle.abort();
    expect(up.abort).toHaveBeenCalledWith(true);

    (up.options.onSuccess as () => void)();
    await handle;
  });
});

describe('UploadManager.getStatus()', () => {
  it('reads the snake_case status the server sends', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        id: 'session-1',
        video_asset_id: 'vid-1',
        status: 'uploading',
        progress_percent: 45,
        file_size: 1000,
        uploaded_bytes: 450,
      }),
    );

    const result = await new UploadManager(mockFetch, 'k', 'https://api.test').getStatus(
      'session-1',
    );

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/uploads/session-1');
    expect(result).toEqual({
      id: 'session-1',
      videoAssetId: 'vid-1',
      status: 'uploading',
      progressPercent: 45,
      fileSize: 1000,
      uploadedBytes: 450,
    });
  });
});

describe('UploadManager.cancel()', () => {
  it('DELETEs the session', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }));
    await new UploadManager(mockFetch, 'k', 'https://api.test').cancel('session-1');
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/uploads/session-1', { method: 'DELETE' });
  });
});
