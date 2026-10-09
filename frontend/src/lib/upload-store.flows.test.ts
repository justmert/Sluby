import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { RateLimitError, SlubyError, type ProcessingJob } from '@sluby/sdk';
import { fakeUploadClient as fakeClient } from '@/test/fake-uploads';
import { fakeBus, fakeLocks } from '@/test/fake-tabs';
import { createUploadTabs } from './upload-tabs';
import { createUploadStore, type UploadStoreOptions } from './upload-store';

/*
 * the flows the audit broke (FLW-04, -05, -21, -22, -23, -26, -45, -46) and
 * the drafts the sheet keeps while closed. each test fails on the store as it
 * was before the final pass.
 */

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
    retryable: true,
    ...overrides,
  };
}

const file = new File([new Uint8Array(100)], 'clip.mp4', { type: 'video/mp4', lastModified: 1 });
const other = new File([new Uint8Array(50)], 'two.mp4', { type: 'video/mp4', lastModified: 2 });
const flush = () => vi.advanceTimersByTimeAsync(0);

function eventTarget() {
  const handlers = new Map<string, Set<() => void>>();
  return {
    addEventListener: (type: string, h: () => void) => {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(h);
    },
    removeEventListener: (type: string, h: () => void) => handlers.get(type)?.delete(h),
    fire: (type: string) => handlers.get(type)?.forEach((h) => h()),
  };
}

function setup(options: UploadStoreOptions = {}) {
  const f = fakeClient();
  const store = createUploadStore(f.client, { unloadTarget: null, ...options });
  const one = () => store.getState().uploads[0];
  return { f, store, one };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('FLW-04: a canceled upload never comes back as unfinished', () => {
  it('marks the unfinished list stale on cancel, dismiss and every phase change', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['uploads', 'unfinished'], []);
    const stale = () => queryClient.getQueryState(['uploads', 'unfinished'])?.isInvalidated;
    const s = setup({ queryClient });
    const key = s.store.start(file, { title: 'Clip' });
    s.f.current().resolveUpload('u1');
    await flush();
    expect(stale()).toBe(true);

    queryClient.setQueryData(['uploads', 'unfinished'], []);
    await s.store.cancel(key);
    expect(stale()).toBe(true);

    queryClient.setQueryData(['uploads', 'unfinished'], []);
    s.store.dismiss(key);
    expect(stale()).toBe(true);
  });

  it('remembers every upload this tab touched, after it was dismissed too', async () => {
    const s = setup();
    const key = s.store.start(file, { title: 'Clip' });
    s.f.current().resolveUpload('u1');
    await flush();
    await s.store.cancel(key);
    s.store.dismiss(key);
    expect(s.store.getState().uploads).toEqual([]);
    expect(s.store.hasSeen('u1')).toBe(true);
    expect(s.store.hasSeen('u2')).toBe(false);
  });

  it('reports the offset a resume really continued from, once the sdk sends bytes', async () => {
    const s = setup();
    s.store.enqueue(file, { title: 'Clip', resumeUploadId: 'u1' });
    expect(s.one().resumedFrom).toBeNull();
    s.f.current().resolveUpload('u1');
    await flush();
    // nothing sent yet: no number to promise
    expect(s.one().resumedFrom).toBeNull();
    s.f.current().progress(40, 100);
    s.f.current().progress(45, 100);
    expect(s.one().resumedFrom).toBe(40);
  });

  it('does not claim a resume when the sdk had to start the upload over', async () => {
    const s = setup();
    s.store.enqueue(file, { title: 'Clip', resumeUploadId: 'u1' });
    s.f.current().resolveUpload('u-new');
    await flush();
    s.f.current().progress(3, 100);
    expect(s.one().resumedFrom).toBeNull();
  });
});

describe('FLW-05: two tabs never send the same file', () => {
  function twoTabs() {
    const bus = fakeBus();
    const locks = fakeLocks();
    const tabA = createUploadTabs({ channel: bus.channel(), locks, pageTarget: null });
    const tabB = createUploadTabs({ channel: bus.channel(), locks, pageTarget: null });
    const a = setup({ tabs: tabA });
    const b = setup({ tabs: tabB });
    return { a, b, tabA, tabB, locks };
  }

  it('refuses a file another tab is sending, without a request', async () => {
    const { a, b } = twoTabs();
    a.store.start(file, { title: 'Clip' });
    await flush();
    expect(a.f.upload).toHaveBeenCalledOnce();

    b.store.start(file, { title: 'Clip' });
    await flush();
    expect(b.f.upload).not.toHaveBeenCalled();
    expect(b.one()).toMatchObject({
      phase: 'failed',
      failedDuring: 'upload',
      canResume: false,
      error: 'This file is already uploading in another tab.',
    });
  });

  it('a refused file does not hold the queue behind it', async () => {
    const { a, b } = twoTabs();
    a.store.start(file, { title: 'Clip' });
    await flush();
    b.store.enqueue(file, { title: 'Clip' });
    b.store.enqueue(other, { title: 'Two' });
    await flush();
    expect(b.f.upload).toHaveBeenCalledOnce();
    expect(b.f.upload.mock.calls[0][0]).toBe(other);
  });

  it('frees the file once the transfer ends, and says what it is sending meanwhile', async () => {
    const { a, b, tabB } = twoTabs();
    a.store.start(file, { title: 'Clip' });
    await flush();
    a.f.current().resolveUpload('u1');
    a.f.current().progress(7, 100);
    // bytes ride on the next heartbeat
    await vi.advanceTimersByTimeAsync(2_000);
    expect(tabB.remote()).toEqual([
      expect.objectContaining({ uploadId: 'u1', bytesUploaded: 7, title: 'Clip' }),
    ]);

    a.f.current().resolveAsset('a1');
    a.f.current().finish();
    await flush();
    expect(tabB.remote()).toEqual([]);
    b.store.start(file, { title: 'Clip' });
    await flush();
    expect(b.f.upload).toHaveBeenCalledOnce();
  });

  it('a failed transfer lets another tab take the file over, and its own resume is then refused', async () => {
    const { a, b } = twoTabs();
    const key = a.store.start(file, { title: 'Clip' });
    await flush();
    a.f.current().fail(new SlubyError('Upload failed: 502', 502));
    await flush();
    b.store.start(file, { title: 'Clip' });
    await flush();
    expect(b.f.upload).toHaveBeenCalledOnce();

    a.store.resumeTransfer(key);
    await flush();
    expect(a.f.upload).toHaveBeenCalledOnce();
    expect(a.one()).toMatchObject({
      phase: 'failed',
      error: 'This file is already uploading in another tab.',
    });
  });

  it('a cancel while the claim is pending stops the upload before it starts', async () => {
    const { a } = twoTabs();
    const key = a.store.start(file, { title: 'Clip' });
    await a.store.cancel(key);
    await flush();
    expect(a.f.upload).not.toHaveBeenCalled();
    expect(a.one()).toMatchObject({ phase: 'cancelled', cleanup: 'nothing' });
  });
});

describe('FLW-21 and FLW-22: a failed run reads like the video page', () => {
  it('stores the plain reason and keeps the raw message on the job', async () => {
    const s = setup();
    s.f.processing.mockResolvedValueOnce(
      job({
        status: 'failed',
        stage: 'failed',
        errorMessage:
          'ffprobe exited with code 1: /app/uploads/x: Invalid data found when processing input',
      }),
    );
    s.store.start(file, { title: 'Clip' });
    s.f.current().resolveAsset('a');
    s.f.current().finish();
    await flush();
    expect(s.one()).toMatchObject({ phase: 'failed', error: 'The file is not a readable video.' });
    expect(s.one().job?.errorMessage).toMatch(/ffprobe/);
  });

  it('counts the attempts of the stage that is being retried', async () => {
    const s = setup();
    s.f.processing
      .mockResolvedValueOnce(job({ stage: 'upload', retryCount: 4 }))
      .mockResolvedValueOnce(job({ status: 'retrying', stage: 'upload', retryCount: 5 }))
      .mockResolvedValue(job({ status: 'retrying', stage: 'upload', retryCount: 6 }));
    s.store.start(file, { title: 'Clip' });
    s.f.current().resolveAsset('a');
    s.f.current().finish();
    await flush();
    expect(s.one().attempt).toBeNull();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(s.one().attempt).toEqual({ n: 2, of: 3 });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(s.one().attempt).toEqual({ n: 3, of: 3 });
  });

  it('does not guess the attempt when the first reading is already a retry', async () => {
    const s = setup();
    s.f.processing.mockResolvedValue(job({ status: 'retrying', stage: 'upload', retryCount: 5 }));
    s.store.start(file, { title: 'Clip' });
    s.f.current().resolveAsset('a');
    s.f.current().finish();
    await flush();
    expect(s.one().attempt).toBeNull();
  });
});

describe('FLW-23: a dropped connection', () => {
  it('says the upload continues when back online, and continues on its own', async () => {
    const target = eventTarget();
    let online = true;
    const s = setup({ onlineTarget: target as unknown as Window, isOnline: () => online });
    s.store.start(file, { title: 'Clip' });
    online = false;
    s.f.current().fail(new SlubyError('Upload failed: tus: failed to upload chunk', 0));
    await flush();
    expect(s.one()).toMatchObject({
      phase: 'failed',
      canResume: true,
      error: 'The connection dropped. The upload continues when you are back online.',
    });

    online = true;
    target.fire('online');
    await flush();
    expect(s.f.upload).toHaveBeenCalledTimes(2);
    expect(s.one()).toMatchObject({ phase: 'uploading', error: null });
  });

  it('names a dropped server connection while the browser is online', async () => {
    const s = setup({ isOnline: () => true, onlineTarget: null });
    s.store.start(file, { title: 'Clip' });
    s.f.current().fail(new SlubyError('Upload failed: tus: failed to upload chunk', 0));
    await flush();
    expect(s.one().error).toBe('The connection to the server dropped.');
  });

  it('holds new uploads while offline and starts them when the connection is back', async () => {
    const target = eventTarget();
    let online = false;
    const s = setup({ onlineTarget: target as unknown as Window, isOnline: () => online });
    s.store.enqueue(file, { title: 'Clip' });
    await flush();
    expect(s.f.upload).not.toHaveBeenCalled();
    expect(s.store.getState()).toMatchObject({ offline: true, queued: [{ title: 'Clip' }] });
    online = true;
    target.fire('online');
    await flush();
    expect(s.f.upload).toHaveBeenCalledOnce();
    expect(s.store.getState().offline).toBe(false);
  });
});

describe('FLW-26: one poller per video, slower when nothing changes, none while hidden', () => {
  async function processingUpload(options: UploadStoreOptions = {}) {
    const s = setup(options);
    s.store.start(file, { title: 'Clip' });
    s.f.current().resolveAsset('a');
    s.f.current().finish();
    await flush();
    return s;
  }

  it('reads the job through the query cache, so a fresh reading is not fetched again', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['assets', 'processing', 'a', 'processing'], job({}));
    const s = await processingUpload({ queryClient });
    expect(s.f.processing).not.toHaveBeenCalled();
    expect(s.one().job).toMatchObject({ stage: 'transcode' });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(s.f.processing).toHaveBeenCalledOnce();
    expect(queryClient.getQueryData(['assets', 'processing', 'a', 'processing'])).toBeDefined();
  });

  it('polls every 2 seconds while the job moves, then every 10 seconds', async () => {
    let p = 0;
    const s = setup();
    s.f.processing.mockImplementation(async () => job({ progressPercent: p }));
    s.store.start(file, { title: 'Clip' });
    s.f.current().resolveAsset('a');
    s.f.current().finish();
    await flush();
    expect(s.f.processing).toHaveBeenCalledTimes(1);
    p = 20;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(s.f.processing).toHaveBeenCalledTimes(2);
    // no change for 10 s: the next readings are 10 s apart
    await vi.advanceTimersByTimeAsync(10_000);
    const calls = s.f.processing.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.f.processing.mock.calls.length - calls).toBeLessThanOrEqual(6);
    p = 40;
    await vi.advanceTimersByTimeAsync(10_000);
    const moved = s.f.processing.mock.calls.length;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(s.f.processing.mock.calls.length).toBe(moved + 1);
  });

  it('stops polling while the tab is hidden and reads at once when it shows again', async () => {
    let hidden = false;
    const listeners = new Set<() => void>();
    const visibility = {
      hidden: () => hidden,
      subscribe: (l: () => void) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    };
    const s = setup({ visibility });
    s.f.processing.mockResolvedValue(job({}));
    s.store.start(file, { title: 'Clip' });
    s.f.current().resolveAsset('a');
    s.f.current().finish();
    await flush();
    hidden = true;
    listeners.forEach((l) => l());
    const before = s.f.processing.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(s.f.processing.mock.calls.length).toBe(before);
    hidden = false;
    listeners.forEach((l) => l());
    await flush();
    expect(s.f.processing.mock.calls.length).toBe(before + 1);
  });

  it('keeps the last stage through a 429 or a network blip and says it checks again', async () => {
    const s = setup();
    s.f.processing
      .mockResolvedValueOnce(job({ stage: 'upload', progressPercent: 70 }))
      .mockRejectedValueOnce(new RateLimitError('Too many requests'))
      .mockResolvedValue(job({ stage: 'upload', progressPercent: 75 }));
    s.store.start(file, { title: 'Clip' });
    s.f.current().resolveAsset('a');
    s.f.current().finish();
    await flush();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(s.one()).toMatchObject({ checking: true, error: null, phase: 'processing' });
    expect(s.one().job).toMatchObject({ progressPercent: 70 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(s.one()).toMatchObject({ checking: false });
    expect(s.one().job).toMatchObject({ progressPercent: 75 });
  });
});

describe('processing percent', () => {
  it('never moves backwards within one attempt, and starts over on a retry', async () => {
    const s = setup();
    s.f.processing
      .mockResolvedValueOnce(job({ stage: 'upload', progressPercent: 70 }))
      .mockResolvedValueOnce(job({ stage: 'upload', progressPercent: 65 }))
      .mockResolvedValueOnce(
        job({ status: 'retrying', stage: 'upload', progressPercent: 60, retryCount: 1 }),
      )
      .mockResolvedValue(job({ stage: 'upload', progressPercent: 62, retryCount: 1 }));
    s.store.start(file, { title: 'Clip' });
    s.f.current().resolveAsset('a');
    s.f.current().finish();
    await flush();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(s.one().job?.progressPercent).toBe(70);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(s.one().job?.progressPercent).toBe(62);
  });
});

describe('FLW-45: the server upload limit', () => {
  it('reads the limit once and refuses a larger file before any request', async () => {
    const readLimit = vi.fn().mockResolvedValue(60);
    const s = setup({ readLimit });
    await s.store.loadLimit();
    await s.store.loadLimit();
    expect(readLimit).toHaveBeenCalledOnce();
    expect(s.store.getState().limit).toBe(60);

    s.store.start(file, { title: 'Clip' });
    await flush();
    expect(s.f.upload).not.toHaveBeenCalled();
    expect(s.one()).toMatchObject({
      phase: 'failed',
      canResume: false,
      error: "100 B is over this server's 60 B limit.",
    });
  });

  it('names the limit when the server answers 413', async () => {
    const s = setup({ readLimit: async () => 10_737_418_240 });
    await s.store.loadLimit();
    s.store.start(file, { title: 'Clip' });
    s.f.current().fail(new SlubyError('Maximum size exceeded', 413));
    await flush();
    expect(s.one().error).toBe("This file is larger than the server's upload limit (10.7 GB).");
  });
});

describe('FLW-46: the queue only waits for a failure that can be resumed', () => {
  it('goes on after a failure that resuming cannot fix', async () => {
    const s = setup();
    s.store.enqueue(file, { title: 'Clip' });
    s.store.enqueue(other, { title: 'Two' });
    s.f.current().fail(new SlubyError('Bad request', 400));
    await flush();
    expect(s.store.getState().queueHeld).toBe(false);
    expect(s.f.upload).toHaveBeenCalledTimes(2);
  });

  it('holds after a failure that resuming can fix', async () => {
    const s = setup({ isOnline: () => true });
    s.store.enqueue(file, { title: 'Clip' });
    s.store.enqueue(other, { title: 'Two' });
    s.f.current().fail(new SlubyError('Bad gateway', 502));
    await flush();
    expect(s.store.getState().queueHeld).toBe(true);
    expect(s.f.upload).toHaveBeenCalledOnce();
  });
});

describe('drafts live in the store, so closing the sheet keeps them', () => {
  it('adds, renames, removes and starts drafts with the shared options', () => {
    const s = setup();
    const [d1, d2] = s.store.addDrafts([file, other]);
    expect(s.store.getState().drafts.map((d) => d.title)).toEqual(['clip', 'two']);
    s.store.updateDraft(d1, { title: 'Clip one' });
    s.store.setDraftOptions({ accessTier: 'private', description: 'ignored for two files' });
    s.store.removeDraft(d2);
    s.store.addDrafts([other]);
    const keys = s.store.startDrafts();
    expect(keys).toHaveLength(2);
    expect(s.store.getState().drafts).toEqual([]);
    expect(s.f.upload.mock.calls[0][1]).toMatchObject({
      title: 'Clip one',
      accessTier: 'private',
      description: undefined,
    });
    expect(s.store.getState().queued).toEqual([expect.objectContaining({ title: 'two' })]);
    // the options are kept for the next batch
    expect(s.store.getState().draftOptions.accessTier).toBe('private');
  });

  it('gives a single draft the description', () => {
    const s = setup();
    s.store.addDrafts([file]);
    s.store.setDraftOptions({ description: '  A clip  ' });
    s.store.startDrafts();
    expect(s.f.upload.mock.calls[0][1]).toMatchObject({ description: 'A clip' });
    expect(s.store.getState().draftOptions.description).toBe('');
  });
});
