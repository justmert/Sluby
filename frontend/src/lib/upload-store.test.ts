import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProcessingJob, SlubyClient } from '@sluby/sdk';
import { createUploadStore } from './upload-store';

function job(overrides: Partial<ProcessingJob>): ProcessingJob {
  return {
    id: 'job',
    status: 'processing',
    stage: 'transcode',
    progressPercent: 10,
    retryCount: 0,
    errorMessage: null,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-10-02T00:00:00Z',
    logs: [],
    ...overrides,
  };
}

/** A fake sdk whose tus upload the test drives by hand. */
function fakeClient() {
  let progress: (pct: number, bytes: number, total: number) => void = () => {};
  let finish!: () => void;
  let fail!: (err: Error) => void;
  let resolveAsset!: (id: string) => void;
  const pause = vi.fn().mockResolvedValue(undefined);
  const resume = vi.fn();
  const abort = vi.fn().mockResolvedValue(undefined);

  const upload = vi.fn((_file: File, opts: { onProgress?: typeof progress }) => {
    progress = opts.onProgress ?? progress;
    const done = new Promise<void>((res, rej) => {
      finish = res;
      fail = rej;
    });
    const assetId = new Promise<string>((res) => (resolveAsset = res));
    return Object.assign(done, { assetId, pause, resume, abort, isPaused: false });
  });
  const processing = vi.fn();
  const retry = vi.fn().mockResolvedValue({ stage: 'upload' });

  const client = { uploads: { upload }, assets: { processing, retry } } as unknown as SlubyClient;
  return {
    client,
    upload,
    processing,
    retry,
    pause,
    resume,
    abort,
    progress: (bytes: number, total: number) => progress(0, bytes, total),
    finish: () => finish(),
    fail: (err: Error) => fail(err),
    resolveAsset: (id: string) => resolveAsset(id),
  };
}

const file = new File([new Uint8Array(100)], 'clip.mp4', { type: 'video/mp4' });
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('upload store', () => {
  it('tracks bytes and speed from tus progress', async () => {
    let t = 0;
    const f = fakeClient();
    const store = createUploadStore(f.client, () => t);
    store.start(file, { title: 'Clip' });

    expect(store.getState()).toMatchObject({ phase: 'uploading', title: 'Clip', bytesTotal: 100 });
    f.progress(0, 100);
    t = 2000;
    f.progress(40, 100);
    expect(store.getState()).toMatchObject({ bytesUploaded: 40, speed: 20 });
  });

  it('polls processing after the transfer and lands on ready', async () => {
    const f = fakeClient();
    const store = createUploadStore(f.client);
    f.processing
      .mockResolvedValueOnce(job({ stage: 'upload', progressPercent: 70 }))
      .mockResolvedValueOnce(
        job({ status: 'completed', stage: 'completed', progressPercent: 100 }),
      );

    store.start(file, { title: 'Clip' });
    f.resolveAsset('asset-1');
    f.finish();
    await flush();

    expect(store.getState()).toMatchObject({ phase: 'processing', assetId: 'asset-1' });
    expect(store.getState().job?.stage).toBe('upload');

    await vi.advanceTimersByTimeAsync(2000);
    expect(store.getState().phase).toBe('ready');
    expect(f.processing).toHaveBeenCalledWith('asset-1');
  });

  it('treats a 404 before the job exists as "not yet"', async () => {
    const f = fakeClient();
    const store = createUploadStore(f.client);
    f.processing
      .mockRejectedValueOnce(Object.assign(new Error('No processing job'), { statusCode: 404 }))
      .mockResolvedValueOnce(job({ stage: 'transcode' }));

    store.start(file, { title: 'Clip' });
    f.resolveAsset('a');
    f.finish();
    await flush();
    expect(store.getState().error).toBeNull();

    await vi.advanceTimersByTimeAsync(2000);
    expect(store.getState().job?.stage).toBe('transcode');
  });

  it('shows the pipeline error and retries via the api', async () => {
    const f = fakeClient();
    const store = createUploadStore(f.client);
    f.processing
      .mockResolvedValueOnce(
        job({ status: 'failed', stage: 'failed', errorMessage: 'ffmpeg exited with code 1' }),
      )
      .mockResolvedValueOnce(job({ stage: 'upload' }));

    store.start(file, { title: 'Clip' });
    f.resolveAsset('a');
    f.finish();
    await flush();

    expect(store.getState()).toMatchObject({
      phase: 'failed',
      failedDuring: 'processing',
      error: 'ffmpeg exited with code 1',
    });

    await store.retryProcessing();
    await flush();
    expect(f.retry).toHaveBeenCalledWith('a');
    expect(store.getState()).toMatchObject({ phase: 'processing', failedDuring: null });
  });

  it('reports a transfer failure without a retry-processing path', async () => {
    const f = fakeClient();
    const store = createUploadStore(f.client);
    store.start(file, { title: 'Clip' });
    f.fail(new Error('tus: unexpected response 413'));
    await flush();

    expect(store.getState()).toMatchObject({
      phase: 'failed',
      failedDuring: 'upload',
      error: 'tus: unexpected response 413',
    });
    await store.retryProcessing();
    expect(f.retry).not.toHaveBeenCalled();
  });

  it('fails loudly when the asset id never arrives', async () => {
    const f = fakeClient();
    const store = createUploadStore(f.client);
    store.start(file, { title: 'Clip' });
    f.finish();
    // the asset id never resolves, so after the grace period it is an error
    await flush();
    expect(store.getState().phase).toBe('uploading');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(store.getState()).toMatchObject({ phase: 'failed', failedDuring: 'upload' });
    expect(store.getState().error).toMatch(/did not report which asset/);
  });

  it('pauses, resumes and cancels the tus transfer', async () => {
    const f = fakeClient();
    const store = createUploadStore(f.client);
    store.start(file, { title: 'Clip' });

    await store.pause();
    expect(f.pause).toHaveBeenCalled();
    expect(store.getState().phase).toBe('paused');

    store.resume();
    expect(f.resume).toHaveBeenCalled();
    expect(store.getState().phase).toBe('uploading');

    await store.cancel();
    expect(f.abort).toHaveBeenCalled();
    expect(store.getState().phase).toBe('cancelled');
  });

  it('refuses a second upload while one is in flight', () => {
    const f = fakeClient();
    const store = createUploadStore(f.client);
    store.start(file, { title: 'Clip' });
    expect(() => store.start(file, { title: 'Again' })).toThrow(/already in progress/);
  });
});
