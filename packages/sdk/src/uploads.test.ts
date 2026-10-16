import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as tus from 'tus-js-client';
import { UploadManager } from './uploads.js';
import type { FetchFn } from './uploads.js';
import { AbortError, PermissionError, SlubyError } from './errors.js';

// Fake tus Upload capturing options + exposing spy control methods, so we can
// drive the creation response, progress, success/error, and pause/resume.
const tusMock = vi.hoisted(() => ({
  previous: [] as unknown[],
  lookupError: null as Error | null,
  removeUpload: vi.fn(async (_key: string) => {}),
  fingerprint: vi.fn(
    async (file: { name?: string; size?: number }, options: { endpoint?: string }) =>
      `tus-br-${file.name}-${file.size}-${options.endpoint}`,
  ),
}));

vi.mock('tus-js-client', () => {
  class Upload {
    static instances: Upload[] = [];
    options: Record<string, (...args: unknown[]) => unknown>;
    url: string | null = null;
    start = vi.fn();
    abort = vi.fn<(shouldTerminate?: boolean) => Promise<void>>().mockResolvedValue(undefined);
    findPreviousUploads = vi.fn(() =>
      tusMock.lookupError ? Promise.reject(tusMock.lookupError) : Promise.resolve(tusMock.previous),
    );
    resumeFromPreviousUpload = vi.fn((p: { uploadUrl: string }) => {
      this.url = p.uploadUrl;
    });
    constructor(_file: unknown, options: Record<string, (...args: unknown[]) => unknown>) {
      this.options = options;
      Upload.instances.push(this);
    }
  }
  return {
    Upload,
    defaultOptions: {
      fingerprint: tusMock.fingerprint,
      urlStorage: { removeUpload: tusMock.removeUpload },
    },
  };
});

function lastUpload() {
  const instances = (tus as unknown as { Upload: { instances: unknown[] } }).Upload.instances;
  return instances[instances.length - 1] as {
    options: Record<string, (...args: unknown[]) => unknown>;
    url: string | null;
    start: ReturnType<typeof vi.fn>;
    abort: ReturnType<typeof vi.fn>;
    findPreviousUploads: ReturnType<typeof vi.fn>;
    resumeFromPreviousUpload: ReturnType<typeof vi.fn>;
  };
}

/** A HEAD answer from the tus server for a stored upload. */
function headResponse(offset: number, length: number, status = 200) {
  return new Response(null, {
    status,
    headers: { 'Upload-Offset': String(offset), 'Upload-Length': String(length) },
  });
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
  tusMock.previous = [];
  tusMock.lookupError = null;
  tusMock.removeUpload.mockClear();
  tusMock.fingerprint.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
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
    // single stream only: parallelUploads would mint multiple assets
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
    const err = await handle.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SlubyError);
    expect((err as SlubyError).cause).toBe(boom);
  });

  it('turns a tus error with a response into the typed error for its status', async () => {
    const onError = vi.fn();
    const handle = make().upload(Buffer.from('data'), { title: 'T', onError });
    await flush();
    const detailed = Object.assign(new Error('tus: unexpected response'), {
      originalResponse: {
        getStatus: () => 403,
        getBody: () => JSON.stringify({ error: 'This key lacks the upload scope' }),
        getHeader: () => undefined,
      },
    });
    (lastUpload().options.onError as (e: Error) => void)(detailed);

    const err = await handle.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PermissionError);
    expect((err as PermissionError).statusCode).toBe(403);
    expect((err as PermissionError).message).toBe('This key lacks the upload scope');
    expect((err as PermissionError).cause).toBe(detailed);
    expect(onError).toHaveBeenCalledWith(err);
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
    await expect(handle).rejects.toBeInstanceOf(AbortError);

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

  it('abort after the upload finished does nothing, so the asset is kept', async () => {
    const handle = make().upload(Buffer.from('data'), { title: 'T' });
    await flush();
    const up = lastUpload();
    up.url = 'https://api.test/api/v1/uploads/u1';
    (up.options.onSuccess as () => void)();
    await handle;

    await handle.abort();

    // abort(true) would send the tus DELETE that discards the asset
    expect(up.abort).not.toHaveBeenCalled();
    await expect(handle).resolves.toBeUndefined();
  });

  it('pause after the upload finished does nothing', async () => {
    const handle = make().upload(Buffer.from('data'), { title: 'T' });
    await flush();
    const up = lastUpload();
    (up.options.onSuccess as () => void)();
    await handle;

    await handle.pause();
    expect(handle.isPaused).toBe(false);
    expect(up.abort).not.toHaveBeenCalled();
  });

  it('rejects instead of hanging when the previous-upload lookup fails', async () => {
    tusMock.lookupError = new Error('localStorage is broken');
    const onError = vi.fn();
    const handle = make().upload(new File(['x'], 'v.mp4', { type: 'video/mp4' }), {
      title: 'T',
      onError,
    });

    const err = await handle.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SlubyError);
    expect((err as SlubyError).cause).toBe(tusMock.lookupError);
    await expect(handle.assetId).rejects.toBe(err);
    await expect(handle.uploadId).rejects.toBe(err);
    expect(onError).toHaveBeenCalledWith(err);
    expect(lastUpload().start).not.toHaveBeenCalled();
  });

  it('resumes an unfinished previous upload of the same file', async () => {
    tusMock.previous = [{ uploadUrl: 'https://api.test/api/v1/uploads/old', urlStorageKey: 'k1' }];
    const fetchMock = vi.fn().mockResolvedValue(headResponse(10, 100));
    vi.stubGlobal('fetch', fetchMock);

    make().upload(new File(['x'], 'v.mp4', { type: 'video/mp4' }), { title: 'T' });
    await vi.waitFor(() => expect(lastUpload().start).toHaveBeenCalledTimes(1));
    const up = lastUpload();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/api/v1/uploads/old',
      expect.objectContaining({ method: 'HEAD' }),
    );
    expect(up.resumeFromPreviousUpload).toHaveBeenCalledWith(tusMock.previous[0]);
    expect(tusMock.removeUpload).not.toHaveBeenCalled();
  });

  it('never resumes a previous upload that already finished: it forgets it and uploads anew', async () => {
    tusMock.previous = [{ uploadUrl: 'https://api.test/api/v1/uploads/done', urlStorageKey: 'k2' }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(headResponse(100, 100)));

    make().upload(new File(['x'], 'v.mp4', { type: 'video/mp4' }), { title: 'T' });
    await vi.waitFor(() => expect(lastUpload().start).toHaveBeenCalledTimes(1));
    const up = lastUpload();

    expect(up.resumeFromPreviousUpload).not.toHaveBeenCalled();
    expect(tusMock.removeUpload).toHaveBeenCalledWith('k2');
  });

  it('does not resume an upload the server no longer has', async () => {
    tusMock.previous = [{ uploadUrl: 'https://api.test/api/v1/uploads/gone', urlStorageKey: 'k3' }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(headResponse(0, 0, 404)));

    make().upload(new File(['x'], 'v.mp4', { type: 'video/mp4' }), { title: 'T' });
    await vi.waitFor(() => expect(lastUpload().start).toHaveBeenCalledTimes(1));

    expect(lastUpload().resumeFromPreviousUpload).not.toHaveBeenCalled();
    expect(tusMock.removeUpload).toHaveBeenCalledWith('k3');
  });

  it('pausing before the lookup lands and resuming still applies the found upload', async () => {
    tusMock.previous = [{ uploadUrl: 'https://api.test/api/v1/uploads/old', urlStorageKey: 'k1' }];
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(headResponse(10, 100)));

    const handle = make().upload(new File(['x'], 'v.mp4', { type: 'video/mp4' }), { title: 'T' });
    await handle.pause();
    await vi.waitFor(() => expect(lastUpload().resumeFromPreviousUpload).toHaveBeenCalledTimes(1));
    await flush();
    const up = lastUpload();
    expect(up.start).not.toHaveBeenCalled();

    handle.resume();
    expect(up.start).toHaveBeenCalledTimes(1);
    expect(up.url).toBe('https://api.test/api/v1/uploads/old');
  });

  it('forgets a finished upload and ties the fingerprint to the key and the metadata', async () => {
    const file = new File(['x'], 'v.mp4', { type: 'video/mp4' });
    make().upload(file, { title: 'First' });
    make().upload(file, { title: 'Second' });
    new UploadManager(mockFetch, { apiKey: 'other_key', baseUrl: 'https://api.test' }).upload(
      file,
      {
        title: 'First',
      },
    );
    await flush();
    const instances = (
      tus as unknown as { Upload: { instances: Array<{ options: Record<string, unknown> }> } }
    ).Upload.instances;

    for (const instance of instances) {
      expect(instance.options.removeFingerprintOnSuccess).toBe(true);
    }
    const prints = await Promise.all(
      instances.map((i) =>
        (i.options.fingerprint as (f: unknown, o: unknown) => Promise<string>)(file, i.options),
      ),
    );
    expect(new Set(prints).size).toBe(3);
    // the key itself never lands in the stored fingerprint
    for (const print of prints) expect(print).not.toContain('sluby_key');
  });

  it('stores nothing for raw bytes, which have no name or date to tell files apart', async () => {
    make().upload(new Uint8Array([1, 2, 3]), { title: 'T' });
    await flush();
    const up = lastUpload();
    const print = await (up.options.fingerprint as (f: unknown, o: unknown) => Promise<unknown>)(
      new Uint8Array([1, 2, 3]),
      up.options,
    );
    expect(print).toBeNull();
  });

  it('resume: false never looks up or stores previous uploads', async () => {
    make().upload(new File(['x'], 'v.mp4', { type: 'video/mp4' }), { title: 'T', resume: false });
    await flush();
    const up = lastUpload();

    expect(up.findPreviousUploads).not.toHaveBeenCalled();
    expect(up.options.storeFingerprintForResuming).toBe(false);
    expect(up.start).toHaveBeenCalledTimes(1);
  });

  it('resolves uploadId from the tus upload url once it exists', async () => {
    const handle = make().upload(Buffer.from('data'), { title: 'T' });
    await flush();
    const up = lastUpload();
    up.url = 'https://api.test/api/v1/uploads/2f1c0a8e-0000-4000-8000-000000000001';
    (up.options.onUploadUrlAvailable as () => void)();

    await expect(handle.uploadId).resolves.toBe('2f1c0a8e-0000-4000-8000-000000000001');
    (up.options.onSuccess as () => void)();
    await handle;
  });

  it('aborts the upload when the signal fires', async () => {
    const controller = new AbortController();
    const handle = make().upload(Buffer.from('data'), { title: 'T', signal: controller.signal });
    await flush();
    const up = lastUpload();

    controller.abort();
    await expect(handle).rejects.toBeInstanceOf(AbortError);
    expect(up.abort).toHaveBeenCalledWith(true);
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

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/uploads/session-1', { signal: undefined });
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
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/uploads/session-1', {
      method: 'DELETE',
      signal: undefined,
    });
  });
});
