import { vi } from 'vitest';
import { AbortError, type SlubyClient } from '@sluby/sdk';

/**
 * A fake sdk whose tus uploads the test drives by hand. It keeps the sdk's
 * handle contract: abort() terminates and rejects the handle with an
 * AbortError (even when the termination fails), abort() after success does
 * nothing, and the id promises reject with the handle.
 */
export function fakeUploadClient() {
  type Upload = {
    progress: (bytes: number, total: number) => void;
    finish: () => void;
    fail: (err: Error) => void;
    resolveAsset: (id: string) => void;
    resolveUpload: (id: string) => void;
    pause: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    abort: ReturnType<typeof vi.fn>;
  };
  const uploads: Upload[] = [];
  // what the server does with a tus DELETE: the next abort() uses it
  let terminate: () => Promise<void> = async () => {};

  const upload = vi.fn(
    (_file: File, opts: { onProgress?: (p: number, b: number, t: number) => void }) => {
      let finished = false;
      let aborted = false;
      let rejectDone!: (err: Error) => void;
      let resolveDone!: () => void;
      const done = new Promise<void>((res, rej) => {
        resolveDone = res;
        rejectDone = rej;
      });
      let resolveAsset!: (id: string) => void;
      let rejectAsset!: (err: Error) => void;
      const assetId = new Promise<string>((res, rej) => {
        resolveAsset = res;
        rejectAsset = rej;
      });
      let resolveUpload!: (id: string) => void;
      let rejectUpload!: (err: Error) => void;
      const uploadId = new Promise<string>((res, rej) => {
        resolveUpload = res;
        rejectUpload = rej;
      });
      assetId.catch(() => {});
      uploadId.catch(() => {});
      const failAll = (err: Error) => {
        rejectAsset(err);
        rejectUpload(err);
        rejectDone(err);
      };
      const u: Upload = {
        progress: (b, t) => opts.onProgress?.(Math.round((b / t) * 100), b, t),
        finish: () => {
          finished = true;
          resolveDone();
        },
        fail: failAll,
        resolveAsset: (id) => resolveAsset(id),
        resolveUpload: (id) => resolveUpload(id),
        pause: vi.fn().mockResolvedValue(undefined),
        resume: vi.fn(),
        abort: vi.fn(async () => {
          if (aborted || finished) return;
          aborted = true;
          try {
            await terminate();
          } finally {
            failAll(new AbortError('Upload aborted.'));
          }
        }),
      };
      uploads.push(u);
      return Object.assign(done, {
        assetId,
        uploadId,
        pause: u.pause,
        resume: u.resume,
        abort: u.abort,
        isPaused: false,
      });
    },
  );
  const processing = vi.fn();
  const get = vi.fn();
  const retry = vi.fn().mockResolvedValue({ stage: 'transcode' });
  const getStatus = vi.fn();
  const cancel = vi.fn().mockResolvedValue(undefined);

  const client = {
    uploads: { upload, getStatus, cancel },
    assets: { processing, retry, get },
  } as unknown as SlubyClient;
  return {
    client,
    upload,
    processing,
    retry,
    get,
    getStatus,
    cancel,
    current: () => uploads[uploads.length - 1],
    all: uploads,
    failTermination: (err: Error) => {
      terminate = async () => {
        throw err;
      };
    },
  };
}
