import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AuthenticationError,
  ConflictError,
  NotFoundError,
  PermissionError,
  SlubyError,
  ValidationError,
  type ProcessingJob,
  type VideoAsset,
} from '@sluby/sdk';
import { fakeUploadClient as fakeClient } from '@/test/fake-uploads';
import { createUploadStore, type UploadStoreOptions } from './upload-store';

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

const assetWith = (status: VideoAsset['status']) => ({ id: 'a', status }) as VideoAsset;

const file = new File([new Uint8Array(100)], 'clip.mp4', { type: 'video/mp4', lastModified: 1 });
const flush = () => vi.advanceTimersByTimeAsync(0);

function setup(options: UploadStoreOptions = {}) {
  const f = fakeClient();
  const store = createUploadStore(f.client, { unloadTarget: null, ...options });
  const one = () => store.getState().uploads[0];
  return { f, store, one };
}

/** Start an upload and finish its transfer with asset `a`. */
async function transferredUpload(options: UploadStoreOptions = {}) {
  const s = setup(options);
  const key = s.store.start(file, { title: 'Clip' });
  s.f.current().resolveUpload('u1');
  s.f.current().resolveAsset('a');
  s.f.current().finish();
  await flush();
  return { ...s, key };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('upload store: transfer', () => {
  it('tracks bytes and speed from tus progress', () => {
    let t = 0;
    const { f, store, one } = setup({ now: () => t });
    store.start(file, { title: 'Clip' });

    expect(one()).toMatchObject({ phase: 'uploading', title: 'Clip', bytesTotal: 100 });
    f.current().progress(0, 100);
    t = 2000;
    f.current().progress(40, 100);
    expect(one()).toMatchObject({ bytesUploaded: 40, speed: 20 });
  });

  it('polls processing after the transfer and lands on ready', async () => {
    const s = setup();
    s.f.processing
      .mockResolvedValueOnce(job({ stage: 'upload', progressPercent: 70 }))
      .mockResolvedValueOnce(job({ status: 'completed', stage: 'completed' }));
    s.store.start(file, { title: 'Clip' });
    s.f.current().resolveAsset('asset-1');
    s.f.current().finish();
    await flush();

    expect(s.one()).toMatchObject({ phase: 'processing', assetId: 'asset-1' });
    expect(s.one().job?.stage).toBe('upload');

    await vi.advanceTimersByTimeAsync(2000);
    expect(s.one().phase).toBe('ready');
    expect(s.f.processing).toHaveBeenCalledWith('asset-1');
    // created (processing) and then ready: both change what the lists show
    expect(s.store.getState().assetVersion).toBe(2);
  });

  it('reports a transfer failure and offers a resume only when retrying can help', async () => {
    const s = setup();
    s.store.start(file, { title: 'Clip' });
    s.f.current().fail(new ValidationError('Upload too large', 400));
    await flush();
    expect(s.one()).toMatchObject({
      phase: 'failed',
      failedDuring: 'upload',
      error: 'Upload too large',
      canResume: false,
    });

    s.store.dismiss(s.one().key);
    s.store.start(file, { title: 'Other' });
    s.f.current().fail(new SlubyError('Upload failed: network down', 0));
    await flush();
    expect(s.one()).toMatchObject({ phase: 'failed', canResume: true });
    await s.store.retryProcessing(s.one().key);
    expect(s.f.retry).not.toHaveBeenCalled();
  });

  it('resumes a failed transfer with the same file and metadata', async () => {
    const s = setup();
    const key = s.store.start(file, { title: 'Clip', description: 'd', accessTier: 'private' });
    s.f.current().fail(new SlubyError('Upload failed: 502', 502));
    await flush();

    s.store.resumeTransfer(key);
    expect(s.f.upload).toHaveBeenCalledTimes(2);
    expect(s.f.upload.mock.calls[1][0]).toBe(file);
    expect(s.f.upload.mock.calls[1][1]).toMatchObject({
      title: 'Clip',
      description: 'd',
      accessTier: 'private',
    });
    expect(s.one()).toMatchObject({ key, phase: 'uploading', error: null });

    s.f.current().resolveAsset('a');
    s.f.current().finish();
    await flush();
    expect(s.one().phase).toBe('processing');
  });

  it('a new start of the same file and metadata replaces its failed card', async () => {
    const s = setup();
    s.store.start(file, { title: 'Clip' });
    s.f.current().fail(new SlubyError('Upload failed: 502', 502));
    await flush();
    s.store.start(file, { title: 'Clip' });
    expect(s.store.getState().uploads).toHaveLength(1);

    s.f.current().fail(new SlubyError('Upload failed: 502', 502));
    await flush();
    s.store.start(file, { title: 'Another title' });
    expect(s.store.getState().uploads).toHaveLength(2);
  });

  it('allows a second upload while the first is processing, and keeps both', async () => {
    const s = await transferredUpload();
    s.f.processing.mockResolvedValue(job({ stage: 'transcode' }));
    expect(s.store.busy()).toBe(false);

    s.store.start(new File([new Uint8Array(5)], 'two.mp4', { type: 'video/mp4' }), {
      title: 'Two',
    });
    const [second, first] = s.store.getState().uploads;
    expect(second).toMatchObject({ title: 'Two', phase: 'uploading' });
    expect(first).toMatchObject({ title: 'Clip', phase: 'processing' });
    expect(() => s.store.start(file, { title: 'Three' })).toThrow(/already in progress/);
  });

  it('shows a finishing phase while waiting for the asset id, then fails loudly', async () => {
    const s = setup();
    s.store.start(file, { title: 'Clip' });
    s.f.current().finish();
    await flush();
    // pause and cancel cannot do anything here, so the phase says so
    expect(s.one().phase).toBe('finishing');
    expect(s.store.busy()).toBe(true);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.one()).toMatchObject({ phase: 'failed', failedDuring: 'upload' });
    expect(s.one().error).toMatch(/did not report which asset/);
  });

  it('a 401 during the transfer fails it and reports the ended session', async () => {
    const onAuthFailure = vi.fn();
    const s = setup({ onAuthFailure });
    s.store.start(file, { title: 'Clip' });
    s.f.current().fail(new AuthenticationError('Not signed in'));
    await flush();
    expect(s.one()).toMatchObject({ phase: 'failed', authFailed: true, canResume: false });
    expect(s.one().error).toMatch(/session ended/i);
    expect(onAuthFailure).toHaveBeenCalledOnce();
  });
});

describe('upload store: pause, resume and cancel', () => {
  it('pauses, shows what the server holds, and resumes', async () => {
    const s = setup();
    const key = s.store.start(file, { title: 'Clip' });
    s.f.current().resolveUpload('u1');
    s.f.current().progress(84, 100);
    await flush();
    s.f.getStatus.mockResolvedValue({ uploadedBytes: 80 });

    await s.store.pause(key);
    expect(s.f.current().pause).toHaveBeenCalled();
    expect(s.f.getStatus).toHaveBeenCalledWith('u1');
    expect(s.one()).toMatchObject({ phase: 'paused', bytesUploaded: 80, speed: 0 });

    s.store.resume(key);
    expect(s.f.current().resume).toHaveBeenCalled();
    expect(s.one().phase).toBe('uploading');
  });

  it('a pause that races the last chunk does not cover processing', async () => {
    const s = setup();
    const key = s.store.start(file, { title: 'Clip' });
    s.f.processing.mockResolvedValue(job({ stage: 'transcode' }));
    let pauseDone!: () => void;
    s.f.current().pause.mockReturnValue(new Promise<void>((r) => (pauseDone = r)));
    s.f.current().resolveAsset('a');

    const pausing = s.store.pause(key);
    s.f.current().finish();
    await flush();
    pauseDone();
    await pausing;

    expect(s.one().phase).toBe('processing');
  });

  it('a cancel during a pause wins', async () => {
    const s = setup();
    const key = s.store.start(file, { title: 'Clip' });
    let pauseDone!: () => void;
    s.f.current().pause.mockReturnValue(new Promise<void>((r) => (pauseDone = r)));

    const pausing = s.store.pause(key);
    await s.store.cancel(key);
    pauseDone();
    await pausing;
    await flush();
    expect(s.one()).toMatchObject({ phase: 'cancelled', cleanup: 'nothing', error: null });
  });

  it('cancels, waits for the server, and only then says the upload was removed', async () => {
    const s = setup();
    const key = s.store.start(file, { title: 'Clip' });
    s.f.current().resolveUpload('u1');
    s.f.current().resolveAsset('a');
    await flush();
    const version = s.store.getState().assetVersion;

    const cancelling = s.store.cancel(key);
    expect(s.one()).toMatchObject({ phase: 'cancelled', cleanup: 'pending' });
    await cancelling;
    expect(s.f.current().abort).toHaveBeenCalled();
    expect(s.one()).toMatchObject({ phase: 'cancelled', cleanup: 'done', error: null });
    expect(s.store.getState().assetVersion).toBe(version + 1);
  });

  it('says so when the server did not remove the partial upload, and can ask again', async () => {
    const s = setup();
    const key = s.store.start(file, { title: 'Clip' });
    s.f.current().resolveUpload('u1');
    await flush();
    s.f.failTermination(new Error('tus: unexpected response while terminating upload, 500'));

    await expect(s.store.cancel(key)).resolves.toBeUndefined();
    expect(s.one()).toMatchObject({ phase: 'cancelled', cleanup: 'failed' });
    expect(s.one().error).toMatch(/did not confirm removing the partial upload/);

    s.f.cancel.mockRejectedValueOnce(new SlubyError('Internal error', 500));
    await s.store.retryCleanup(key);
    expect(s.one().cleanup).toBe('failed');

    await s.store.retryCleanup(key);
    expect(s.f.cancel).toHaveBeenLastCalledWith('u1');
    expect(s.one()).toMatchObject({ cleanup: 'done', error: null });
  });

  it('a cleanup retry that finds the upload already gone counts as removed', async () => {
    const s = setup();
    const key = s.store.start(file, { title: 'Clip' });
    s.f.current().resolveUpload('u1');
    await flush();
    s.f.failTermination(new Error('terminate failed'));
    await s.store.cancel(key);
    s.f.cancel.mockRejectedValueOnce(new NotFoundError('Upload not found'));
    await s.store.retryCleanup(key);
    expect(s.one().cleanup).toBe('done');
  });

  it('a cancel that loses to the last chunk keeps following the upload', async () => {
    const s = setup();
    const key = s.store.start(file, { title: 'Clip' });
    s.f.processing.mockResolvedValue(job({ stage: 'transcode' }));
    s.f.current().resolveAsset('a');
    s.f.current().finish();
    // the success is queued but the store has not seen it yet
    await s.store.cancel(key);
    await flush();
    expect(s.one()).toMatchObject({ phase: 'processing', cleanup: null, assetId: 'a' });
    expect(s.one().notice).toMatch(/finished before it could be cancelled/);
  });

  it('a cleanup retry answered 409 follows the finished upload instead', async () => {
    const s = setup();
    s.f.processing.mockResolvedValue(job({ stage: 'transcode' }));
    const key = s.store.start(file, { title: 'Clip' });
    s.f.current().resolveUpload('u1');
    s.f.current().resolveAsset('a');
    await flush();
    s.f.failTermination(new Error('terminate failed'));
    await s.store.cancel(key);
    s.f.cancel.mockRejectedValueOnce(new ConflictError('Upload already completed'));
    await s.store.retryCleanup(key);
    await flush();
    expect(s.one()).toMatchObject({ phase: 'processing', cleanup: null });
    expect(s.f.processing).toHaveBeenCalledWith('a');
  });
});

describe('upload store: processing poll', () => {
  it('treats a 404 before the job exists as "not yet"', async () => {
    const s = setup();
    s.f.processing
      .mockRejectedValueOnce(new NotFoundError('No processing job found for this asset'))
      .mockResolvedValueOnce(job({ stage: 'transcode' }));
    s.f.get.mockResolvedValue(assetWith('processing'));
    s.store.start(file, { title: 'Clip' });
    s.f.current().resolveAsset('a');
    s.f.current().finish();
    await flush();
    expect(s.one().error).toBeNull();

    await vi.advanceTimersByTimeAsync(2000);
    expect(s.one().job?.stage).toBe('transcode');
  });

  it('stops and says so when the asset is deleted during processing', async () => {
    const s = await transferredUpload();
    s.f.processing.mockRejectedValue(new NotFoundError('No processing job found for this asset'));
    s.f.get.mockRejectedValue(new NotFoundError('Video asset not found'));
    await vi.advanceTimersByTimeAsync(2000);
    const calls = s.f.processing.mock.calls.length;

    expect(s.one()).toMatchObject({ phase: 'failed', assetGone: true });
    expect(s.one().error).toMatch(/deleted before processing finished/);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(s.f.processing.mock.calls.length).toBe(calls);
    // nothing left to retry
    await s.store.retryProcessing(s.key);
    expect(s.f.retry).not.toHaveBeenCalled();
  });

  it('reads the asset when the job is missing and lands on its real state', async () => {
    const s = await transferredUpload();
    s.f.processing.mockRejectedValue(new NotFoundError('No processing job found for this asset'));
    s.f.get.mockResolvedValue(assetWith('failed'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(s.one()).toMatchObject({ phase: 'failed', failedDuring: 'processing' });
  });

  it('gives up waiting for a job after a minute, and can check again', async () => {
    let t = 0;
    const s = await transferredUpload({ now: () => t });
    s.f.processing.mockRejectedValue(new NotFoundError('No processing job found for this asset'));
    s.f.get.mockResolvedValue(assetWith('processing'));
    for (let i = 0; i < 40; i++) {
      t += 2000;
      await vi.advanceTimersByTimeAsync(2000);
    }
    const calls = s.f.processing.mock.calls.length;
    expect(calls).toBeLessThanOrEqual(32);
    expect(s.one()).toMatchObject({ phase: 'processing', pollStopped: true });
    expect(s.one().error).toMatch(/has not started/);

    s.f.processing.mockResolvedValueOnce(job({ stage: 'transcode' }));
    s.store.refresh(s.key);
    await flush();
    expect(s.one()).toMatchObject({ pollStopped: false, error: null });
    expect(s.one().job?.stage).toBe('transcode');
  });

  it('stops polling on a 401 and reports it once', async () => {
    const onAuthFailure = vi.fn();
    const s = await transferredUpload({ onAuthFailure });
    s.f.processing.mockRejectedValue(new AuthenticationError('Not signed in'));
    await vi.advanceTimersByTimeAsync(60_000);

    expect(s.f.processing).toHaveBeenCalledTimes(2);
    expect(s.one()).toMatchObject({ authFailed: true });
    expect(s.one().error).toMatch(/session ended/i);
    expect(onAuthFailure).toHaveBeenCalledOnce();
  });

  it('stops polling on another client error, keeps polling through server errors', async () => {
    const s = await transferredUpload();
    s.f.processing.mockRejectedValueOnce(new SlubyError('Bad gateway', 502));
    await vi.advanceTimersByTimeAsync(2000);
    expect(s.one().error).toMatch(/Bad gateway/);
    expect(s.one().pollStopped).toBe(false);

    s.f.processing.mockRejectedValue(new PermissionError('Missing scope'));
    await vi.advanceTimersByTimeAsync(2000);
    const calls = s.f.processing.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.f.processing.mock.calls.length).toBe(calls);
    expect(s.one().pollStopped).toBe(true);
  });

  it('shows the pipeline error and retries via the api', async () => {
    const s = setup();
    s.f.processing
      .mockResolvedValueOnce(
        job({ status: 'failed', stage: 'failed', errorMessage: 'ffmpeg exited with code 1' }),
      )
      .mockResolvedValueOnce(job({ stage: 'transcode' }));
    const key = s.store.start(file, { title: 'Clip' });
    s.f.current().resolveAsset('a');
    s.f.current().finish();
    await flush();

    expect(s.one()).toMatchObject({
      phase: 'failed',
      failedDuring: 'processing',
      error: 'ffmpeg exited with code 1',
    });

    await s.store.retryProcessing(key);
    await flush();
    expect(s.f.retry).toHaveBeenCalledWith('a');
    expect(s.one()).toMatchObject({ phase: 'processing', failedDuring: null, error: null });
  });

  it('a failed retry request goes back to failed with the reason', async () => {
    const s = setup();
    s.f.processing.mockResolvedValueOnce(job({ status: 'failed', stage: 'failed' }));
    const key = s.store.start(file, { title: 'Clip' });
    s.f.current().resolveAsset('a');
    s.f.current().finish();
    await flush();
    s.f.retry.mockRejectedValueOnce(
      new NotFoundError('Source file not found, please re-upload the video', undefined, 410),
    );
    await s.store.retryProcessing(key);
    expect(s.one()).toMatchObject({
      phase: 'failed',
      error: 'Source file not found, please re-upload the video',
    });
  });

  it('dismissing an upload stops its poll', async () => {
    const s = await transferredUpload();
    s.f.processing.mockResolvedValue(job({ status: 'failed', stage: 'failed' }));
    await vi.advanceTimersByTimeAsync(2000);
    s.store.dismiss(s.key);
    expect(s.store.getState().uploads).toHaveLength(0);
    const calls = s.f.processing.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.f.processing.mock.calls.length).toBe(calls);
  });
});

describe('upload store: leaving the page', () => {
  it('asks before closing the tab while a transfer runs', async () => {
    const target = new EventTarget();
    const f = fakeClient();
    const store = createUploadStore(f.client, {
      unloadTarget: target as unknown as Window,
    });
    const leave = () => {
      const e = new Event('beforeunload', { cancelable: true });
      target.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(leave()).toBe(false);

    const key = store.start(file, { title: 'Clip' });
    expect(leave()).toBe(true);
    await store.pause(key);
    expect(leave()).toBe(true);
    await store.cancel(key);
    await flush();
    expect(leave()).toBe(false);
  });
});
