import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as tus from 'tus-js-client';
import { UploadManager } from './uploads.js';
import type { FetchFn } from './uploads.js';

// Fake tus Upload capturing the options and exposing spy control methods, so
// we can drive progress/success and assert pause/resume/abort wiring.
vi.mock('tus-js-client', () => {
  class Upload {
    static instances: Upload[] = [];
    options: Record<string, (...args: unknown[]) => void>;
    start = vi.fn();
    abort = vi.fn<(shouldTerminate?: boolean) => Promise<void>>().mockResolvedValue(undefined);
    findPreviousUploads = vi.fn().mockResolvedValue([]);
    resumeFromPreviousUpload = vi.fn();
    constructor(_file: unknown, options: Record<string, (...args: unknown[]) => void>) {
      this.options = options;
      Upload.instances.push(this);
    }
  }
  return { Upload };
});

function lastUpload() {
  const instances = (tus as unknown as { Upload: { instances: unknown[] } }).Upload.instances;
  return instances[instances.length - 1] as {
    options: Record<string, (...args: unknown[]) => void>;
    start: ReturnType<typeof vi.fn>;
    abort: ReturnType<typeof vi.fn>;
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

// ---------------------------------------------------------------------------
// Mock fetch function (the internal _fetch passed from the client)
// ---------------------------------------------------------------------------

let mockFetch: ReturnType<typeof vi.fn<FetchFn>>;

function makeJsonResponse(body: unknown): Response {
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UploadManager.create()', () => {
  it('should POST to /api/v1/uploads with snake_case body', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        video_asset_id: 'vid_123',
        upload_url: 'https://tus.sluby.app/upload/abc',
      }),
    );

    const manager = new UploadManager(mockFetch, 'sluby_key');
    const result = await manager.create({
      title: 'My Video',
      description: 'A test video',
      accessTier: 'public',
    });

    // Verify the request
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'My Video',
        description: 'A test video',
        access_tier: 'public',
      }),
    });

    // Verify snake_case -> camelCase mapping
    expect(result).toEqual({
      videoAssetId: 'vid_123',
      uploadUrl: 'https://tus.sluby.app/upload/abc',
    });
  });

  it('should send correct body when no optional fields provided', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        video_asset_id: 'vid_456',
        upload_url: 'https://tus.sluby.app/upload/def',
      }),
    );

    const manager = new UploadManager(mockFetch, 'sluby_key');
    await manager.create({
      title: 'Public Video',
      description: 'Public',
      accessTier: 'public',
    });

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init!.body as string);
    expect(body).toEqual({
      title: 'Public Video',
      description: 'Public',
      access_tier: 'public',
    });
  });
});

describe('UploadManager.getStatus()', () => {
  it('should GET /api/v1/uploads/:id and map snake_case response', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        id: 'upload_1',
        video_asset_id: 'vid_1',
        upload_url: 'https://tus.example.com/u',
        status: 'uploading',
        progress_percent: 45,
        file_size: 10000000,
        uploaded_bytes: 4500000,
      }),
    );

    const manager = new UploadManager(mockFetch, 'sluby_key');
    const result = await manager.getStatus('upload_1');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/uploads/upload_1');

    expect(result).toEqual({
      id: 'upload_1',
      videoAssetId: 'vid_1',
      uploadUrl: 'https://tus.example.com/u',
      status: 'uploading',
      progressPercent: 45,
      fileSize: 10000000,
      uploadedBytes: 4500000,
    });
  });

  it('should encode special characters in upload ID', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        id: 'a/b',
        video_asset_id: 'v',
        upload_url: 'u',
        status: 'created',
        progress_percent: 0,
        file_size: 0,
        uploaded_bytes: 0,
      }),
    );

    const manager = new UploadManager(mockFetch, 'sluby_key');
    await manager.getStatus('a/b');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/uploads/a%2Fb');
  });
});

describe('UploadManager.uploadFile()', () => {
  it('starts the upload, reports progress, and resolves on success', async () => {
    const manager = new UploadManager(mockFetch, 'sluby_key');
    const onProgress = vi.fn();
    const onSuccess = vi.fn();

    const handle = manager.uploadFile('https://tus/upload', Buffer.from('data'), {
      onProgress,
      onSuccess,
    });
    await flush(); // let findPreviousUploads().then(start) run

    const up = lastUpload();
    expect(up.start).toHaveBeenCalledTimes(1);
    expect(up.options.headers).toMatchObject({ Authorization: 'Bearer sluby_key' });

    // tus reports raw bytes; the SDK forwards percent + raw bytes.
    up.options.onProgress(50, 200);
    expect(onProgress).toHaveBeenCalledWith(25, 50, 200);

    up.options.onSuccess();
    await expect(handle).resolves.toBeUndefined();
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('rejects and calls onError on unrecoverable failure', async () => {
    const manager = new UploadManager(mockFetch, 'sluby_key');
    const onError = vi.fn();
    const handle = manager.uploadFile('https://tus/upload', Buffer.from('data'), { onError });
    await flush();

    const up = lastUpload();
    const boom = new Error('network down');
    up.options.onError(boom);

    await expect(handle).rejects.toThrow('network down');
    expect(onError).toHaveBeenCalledWith(boom);
  });

  it('pause() aborts without terminating and flips isPaused; resume() restarts', async () => {
    const manager = new UploadManager(mockFetch, 'sluby_key');
    const handle = manager.uploadFile('https://tus/upload', Buffer.from('data'));
    await flush();

    const up = lastUpload();
    expect(handle.isPaused).toBe(false);

    await handle.pause();
    expect(up.abort).toHaveBeenCalledWith(false);
    expect(handle.isPaused).toBe(true);

    handle.resume();
    expect(handle.isPaused).toBe(false);
    // start(): once on initial launch, once on resume.
    expect(up.start).toHaveBeenCalledTimes(2);

    // Settle the pending promise so the test does not leak it.
    up.options.onSuccess();
    await handle;
  });

  it('abort() terminates the upload', async () => {
    const manager = new UploadManager(mockFetch, 'sluby_key');
    const handle = manager.uploadFile('https://tus/upload', Buffer.from('data'));
    await flush();

    const up = lastUpload();
    await handle.abort();
    expect(up.abort).toHaveBeenCalledWith(true);

    up.options.onSuccess();
    await handle;
  });
});

describe('UploadManager.cancel()', () => {
  it('should DELETE /api/v1/uploads/:id', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({}));

    const manager = new UploadManager(mockFetch, 'sluby_key');
    await manager.cancel('upload_1');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/uploads/upload_1', {
      method: 'DELETE',
    });
  });

  it('should encode the upload ID', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({}));

    const manager = new UploadManager(mockFetch, 'sluby_key');
    await manager.cancel('id with spaces');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/uploads/id%20with%20spaces', {
      method: 'DELETE',
    });
  });
});
