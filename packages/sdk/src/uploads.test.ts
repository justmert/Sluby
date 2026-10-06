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
  const make = () =>
    new UploadManager(mockFetch, { apiKey: 'sluby_key', baseUrl: 'https://api.test' });

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

  it('resolves assetId via a HEAD on Location when the POST omits Upload-Metadata', async () => {
    // The tus creation POST only returns Location; the asset id is fetched from
    // the upload metadata via a follow-up HEAD (what a real @tus/server does).
    const fetchMock = vi.fn().mockResolvedValue({
      headers: {
        get: (n: string) => (n === 'Upload-Metadata' ? metadataHeader('asset-head') : null),
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    const handle = make().upload(Buffer.from('data'), { title: 'T' });
    await flush();
    const up = lastUpload();

    (up.options.onAfterResponse as (req: unknown, res: unknown) => void)(
      {},
      {
        getHeader: (name: string) =>
          name === 'Location' ? 'http://api.test/files/abc' : undefined,
      },
    );

    await expect(handle.assetId).resolves.toBe('asset-head');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://api.test/files/abc',
      expect.objectContaining({ method: 'HEAD' }),
    );

    (up.options.onSuccess as () => void)();
    await handle;
    vi.unstubAllGlobals();
  });

  it('sends no Authorization header in cookie-session mode', async () => {
    const handle = new UploadManager(mockFetch, { baseUrl: 'https://api.test' }).upload(
      Buffer.from('data'),
      { title: 'T' },
    );
    await flush();
    const up = lastUpload();
    expect(up.options.headers).toEqual({});
    // same-origin: no XHR hook needed, the browser sends the cookie itself
    expect(up.options.onBeforeRequest).toBeUndefined();
    (up.options.onSuccess as () => void)();
    await handle;
  });

  it("sets XHR withCredentials and HEAD credentials when credentials is 'include'", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      headers: {
        get: (n: string) => (n === 'Upload-Metadata' ? metadataHeader('asset-x') : null),
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    const handle = new UploadManager(mockFetch, {
      baseUrl: 'https://api.test',
      credentials: 'include',
    }).upload(Buffer.from('data'), { title: 'T' });
    await flush();
    const up = lastUpload();

    const xhr = { withCredentials: false };
    (up.options.onBeforeRequest as (req: unknown) => void)({ getUnderlyingObject: () => xhr });
    expect(xhr.withCredentials).toBe(true);

    (up.options.onAfterResponse as (req: unknown, res: unknown) => void)(
      {},
      { getHeader: (name: string) => (name === 'Location' ? 'https://api.test/u/1' : undefined) },
    );
    await expect(handle.assetId).resolves.toBe('asset-x');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/u/1',
      expect.objectContaining({
        method: 'HEAD',
        credentials: 'include',
        headers: { 'Tus-Resumable': '1.0.0' },
      }),
    );

    (up.options.onSuccess as () => void)();
    await handle;
    vi.unstubAllGlobals();
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
    // the handle documents that termination rejects it
    await expect(handle).rejects.toThrow('Upload aborted');

    // a resume after abort must not restart the terminated upload
    await handle.pause();
    handle.resume();
    expect(up.start).toHaveBeenCalledTimes(2);
  });

  it('abort before the previous-upload lookup resolves never starts the upload', async () => {
    const handle = make().upload(Buffer.from('data'), { title: 'T' });
    const up = lastUpload();
    const settled = expect(handle).rejects.toThrow('Upload aborted');
    await handle.abort();
    await flush();

    expect(up.start).not.toHaveBeenCalled();
    await settled;
    await expect(handle.assetId).rejects.toThrow('Upload aborted');
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

    const result = await new UploadManager(mockFetch, {
      apiKey: 'k',
      baseUrl: 'https://api.test',
    }).getStatus('session-1');

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
    await new UploadManager(mockFetch, { apiKey: 'k', baseUrl: 'https://api.test' }).cancel(
      'session-1',
    );
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/uploads/session-1', { method: 'DELETE' });
  });
});
