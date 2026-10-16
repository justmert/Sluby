import { useSyncExternalStore } from 'react';
import type { AccessTier, AssetUploadHandle, ProcessingJob, SlubyClient } from '@sluby/sdk';

// tus chunk size the studio uploads with; the progress strip draws these
export const CHUNK_SIZE = 8 * 1024 * 1024;
const POLL_MS = 2_000;
// the sdk reads the asset id with a HEAD right after creation; once the bytes
// are all sent it has had ample time, so do not wait on it forever
const ASSET_ID_GRACE_MS = 10_000;
// the server creates the processing job before it answers the last chunk, so
// a job that is still missing after this long is not coming on its own
const JOB_WAIT_MS = 60_000;

export type UploadPhase =
  | 'uploading'
  | 'paused'
  // every byte is sent, waiting for the server to say which asset it made
  | 'finishing'
  | 'processing'
  | 'ready'
  | 'failed'
  | 'cancelled';

export interface UploadState {
  /** Local id of this upload in the store. */
  key: string;
  phase: UploadPhase;
  fileName: string;
  title: string;
  bytesUploaded: number;
  bytesTotal: number;
  /** Bytes per second over the last few seconds of transfer. */
  speed: number;
  assetId: string | null;
  /** The tus upload id, once the server created the upload. */
  uploadId: string | null;
  job: ProcessingJob | null;
  /** Where it failed: the byte transfer, or the pipeline after it. */
  failedDuring: 'upload' | 'processing' | null;
  error: string | null;
  /** The transfer stopped on something worth trying again (network, server error). */
  canResume: boolean;
  /** The asset was deleted while it was processing. */
  assetGone: boolean;
  /** The session ended (401); nothing works until the user signs in again. */
  authFailed: boolean;
  /** The processing poll gave up; `refresh` starts it again. */
  pollStopped: boolean;
  /**
   * For a cancelled upload: whether the server removed what it had. `nothing`
   * means the upload was cancelled before the server created it.
   */
  cleanup: 'pending' | 'done' | 'failed' | 'nothing' | null;
  /** Something the user should know that is not an error. */
  notice: string | null;
}

export interface UploadsState {
  /** Newest first. At most one of them is transferring. */
  uploads: UploadState[];
  /**
   * Bumps whenever an upload changed what the asset lists show (an asset was
   * created, became ready, failed or was removed), so cached lists can refetch.
   */
  assetVersion: number;
}

export interface StartOptions {
  title: string;
  description?: string;
  accessTier?: AccessTier;
}

export interface UploadStoreOptions {
  now?: () => number;
  /** Called once per 401, so the app can send the user back to sign-in. */
  onAuthFailure?: () => void;
  /** Where to register the leave-page warning; none outside a browser. */
  unloadTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
}

type Sample = { at: number; bytes: number };

interface Attempt {
  handle: AssetUploadHandle;
  cancelled: boolean;
  succeeded: boolean;
}

interface Task {
  file: File;
  options: StartOptions;
  attempt: Attempt | null;
  samples: Sample[];
  pollTimer: ReturnType<typeof setTimeout> | undefined;
  // bumps whenever polling stops or restarts, so an old poll's result is dropped
  pollGen: number;
  jobWaitSince: number | null;
}

const TRANSFERRING: readonly UploadPhase[] = ['uploading', 'paused', 'finishing'];

export const isTransferring = (u: UploadState) => TRANSFERRING.includes(u.phase);

const SESSION_ENDED = 'Your session ended. Sign in again to continue.';

/** The HTTP status an sdk error carries, 0 for network and client-side errors. */
function statusOf(err: unknown): number {
  const status = (err as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === 'number' ? status : 0;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

const isAbort = (err: unknown) => (err as { name?: string } | null)?.name === 'AbortError';

// a transfer that stopped on these can work on a second try
const retryable = (err: unknown) => {
  const s = statusOf(err);
  return s === 0 || s === 408 || s === 429 || s >= 500;
};

const sameFile = (a: File, b: File) =>
  a.name === b.name && a.size === b.size && a.type === b.type && a.lastModified === b.lastModified;

const sameOptions = (a: StartOptions, b: StartOptions) =>
  a.title === b.title &&
  (a.description ?? '') === (b.description ?? '') &&
  (a.accessTier ?? 'public') === (b.accessTier ?? 'public');

let keySeq = 0;

/**
 * The studio's uploads, kept outside react so they survive navigating between
 * studio pages: the tus transfer and the processing polls keep going and the
 * upload page picks the state back up when it mounts again. One transfer runs
 * at a time; earlier uploads stay listed while they process.
 */
export function createUploadStore(client: SlubyClient, opts: UploadStoreOptions = {}) {
  const now = opts.now ?? Date.now;
  const unloadTarget =
    opts.unloadTarget !== undefined
      ? opts.unloadTarget
      : typeof window !== 'undefined'
        ? window
        : null;
  let state: UploadsState = { uploads: [], assetVersion: 0 };
  const tasks = new Map<string, Task>();
  const listeners = new Set<() => void>();
  let guarding = false;

  // closing the tab drops the in-memory transfer, so ask first
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    e.preventDefault();
    // older safari only prompts when returnValue is set
    e.returnValue = '';
  };

  const syncUnloadGuard = () => {
    if (!unloadTarget) return;
    const needed = state.uploads.some((u) => isTransferring(u) || u.cleanup === 'pending');
    if (needed === guarding) return;
    guarding = needed;
    if (needed) unloadTarget.addEventListener('beforeunload', onBeforeUnload);
    else unloadTarget.removeEventListener('beforeunload', onBeforeUnload);
  };

  const emit = () => {
    syncUnloadGuard();
    listeners.forEach((l) => l());
  };

  const get = (key: string) => state.uploads.find((u) => u.key === key);

  const set = (key: string, patch: Partial<UploadState>) => {
    if (!get(key)) return;
    state = {
      ...state,
      uploads: state.uploads.map((u) => (u.key === key ? { ...u, ...patch } : u)),
    };
    emit();
  };

  const assetChanged = (key: string) => {
    if (!get(key)?.assetId) return;
    state = { ...state, assetVersion: state.assetVersion + 1 };
    emit();
  };

  const authFailed = (key: string, patch: Partial<UploadState> = {}) => {
    stopPolling(key);
    set(key, { ...patch, authFailed: true, error: SESSION_ENDED, canResume: false, speed: 0 });
    opts.onAuthFailure?.();
  };

  function stopPolling(key: string) {
    const task = tasks.get(key);
    if (!task) return;
    clearTimeout(task.pollTimer);
    task.pollTimer = undefined;
    task.pollGen++;
  }

  function startPolling(key: string) {
    const task = tasks.get(key);
    if (!task) return;
    stopPolling(key);
    task.jobWaitSince = null;
    set(key, { pollStopped: false });
    void poll(key, task.pollGen);
  }

  /** What a missing job means: look at the asset itself. */
  async function explainMissingJob(key: string, assetId: string, gen: number) {
    const task = tasks.get(key)!;
    let asset;
    try {
      asset = await client.assets.get(assetId);
    } catch (err) {
      if (task.pollGen !== gen) return 'stop';
      const status = statusOf(err);
      if (status === 401) {
        authFailed(key);
        return 'stop';
      }
      if (status === 404) {
        stopPolling(key);
        set(key, {
          phase: 'failed',
          failedDuring: 'processing',
          assetGone: true,
          error: 'This video was deleted before processing finished.',
        });
        assetChanged(key);
        return 'stop';
      }
      // could not tell; keep polling and say why the status is stale
      set(key, { error: `Could not read processing status: ${message(err)}` });
      return 'continue';
    }
    if (task.pollGen !== gen) return 'stop';
    if (asset.status === 'ready') {
      set(key, { phase: 'ready', error: null });
      assetChanged(key);
      return 'stop';
    }
    if (asset.status === 'failed') {
      set(key, {
        phase: 'failed',
        failedDuring: 'processing',
        error: 'Processing failed before it recorded a reason.',
      });
      assetChanged(key);
      return 'stop';
    }
    task.jobWaitSince ??= now();
    if (now() - task.jobWaitSince >= JOB_WAIT_MS) {
      stopPolling(key);
      set(key, {
        pollStopped: true,
        error: 'Processing has not started after a minute. Check again, or open the asset.',
      });
      return 'stop';
    }
    return 'continue';
  }

  async function poll(key: string, gen: number) {
    const task = tasks.get(key);
    const assetId = get(key)?.assetId;
    if (!task || !assetId || task.pollGen !== gen) return;
    try {
      const job = await client.assets.processing(assetId);
      if (task.pollGen !== gen) return;
      task.jobWaitSince = null;
      if (job.status === 'completed') {
        set(key, { job, phase: 'ready', error: null });
        assetChanged(key);
        return;
      }
      if (job.status === 'failed') {
        set(key, {
          job,
          phase: 'failed',
          failedDuring: 'processing',
          error: job.errorMessage ?? 'Processing failed',
        });
        assetChanged(key);
        return;
      }
      set(key, { job, error: null });
    } catch (err) {
      if (task.pollGen !== gen) return;
      const status = statusOf(err);
      if (status === 401) {
        authFailed(key);
        return;
      }
      if (status === 404) {
        if ((await explainMissingJob(key, assetId, gen)) === 'stop') return;
      } else if (status >= 400 && status < 500) {
        // a client error does not go away by asking again
        stopPolling(key);
        set(key, { pollStopped: true, error: `Could not read processing status: ${message(err)}` });
        return;
      } else {
        set(key, { error: `Could not read processing status: ${message(err)}` });
      }
    }
    if (task.pollGen !== gen) return;
    task.pollTimer = setTimeout(() => void poll(key, gen), POLL_MS);
  }

  const recordProgress = (key: string, bytes: number, total: number) => {
    const task = tasks.get(key)!;
    const t = now();
    task.samples.push({ at: t, bytes });
    // a short sliding window keeps the speed responsive without jitter
    task.samples = task.samples.filter((s) => t - s.at <= 5_000);
    const first = task.samples[0];
    const elapsed = (t - first.at) / 1000;
    const speed = elapsed > 0 ? (bytes - first.bytes) / elapsed : (get(key)?.speed ?? 0);
    set(key, { bytesUploaded: bytes, bytesTotal: total, speed: Math.max(0, speed) });
  };

  /** All bytes are on the server: wait for the asset id, then follow processing. */
  async function transferred(key: string, attempt: Attempt, notice: string | null = null) {
    set(key, {
      phase: 'finishing',
      bytesUploaded: get(key)?.bytesTotal ?? 0,
      speed: 0,
      cleanup: null,
      notice,
    });
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const assetId = await Promise.race([
      attempt.handle.assetId.catch(() => null),
      new Promise<null>((resolve) => {
        graceTimer = setTimeout(() => resolve(null), ASSET_ID_GRACE_MS);
      }),
    ]);
    clearTimeout(graceTimer);
    const task = tasks.get(key);
    if (!task || task.attempt !== attempt) return;
    task.attempt = null;
    if (!assetId) {
      set(key, {
        phase: 'failed',
        failedDuring: 'upload',
        error: 'The upload finished but the server did not report which asset it created.',
      });
      return;
    }
    set(key, { phase: 'processing', assetId });
    assetChanged(key);
    startPolling(key);
  }

  function runAttempt(key: string) {
    const task = tasks.get(key)!;
    task.samples = [];
    const h = client.uploads.upload(task.file, {
      title: task.options.title,
      description: task.options.description,
      accessTier: task.options.accessTier,
      chunkSize: CHUNK_SIZE,
      onProgress: (_pct, bytes, total) => {
        if (task.attempt === attempt && !attempt.cancelled) recordProgress(key, bytes, total);
      },
    });
    const attempt: Attempt = { handle: h, cancelled: false, succeeded: false };
    task.attempt = attempt;

    h.assetId.then(
      (assetId) => {
        if (task.attempt === attempt) set(key, { assetId });
      },
      () => {
        // the upload's own rejection below reports the failure
      },
    );
    h.uploadId.then(
      (uploadId) => {
        if (task.attempt === attempt) set(key, { uploadId });
      },
      () => {},
    );

    h.then(
      () => {
        attempt.succeeded = true;
        if (task.attempt !== attempt || attempt.cancelled) return;
        void transferred(key, attempt);
      },
      (err: unknown) => {
        if (task.attempt !== attempt || attempt.cancelled) return;
        task.attempt = null;
        if (statusOf(err) === 401) {
          authFailed(key, { phase: 'failed', failedDuring: 'upload' });
          return;
        }
        set(key, {
          phase: 'failed',
          failedDuring: 'upload',
          error: message(err),
          canResume: !isAbort(err) && retryable(err),
          speed: 0,
        });
      },
    );
  }

  /** Show what the server holds after a pause, not the chunk tus dropped mid-flight. */
  async function showCommittedBytes(key: string, attempt: Attempt) {
    const uploadId = get(key)?.uploadId;
    if (!uploadId) return;
    let session;
    try {
      session = await client.uploads.getStatus(uploadId);
    } catch (err) {
      if (statusOf(err) === 401) authFailed(key);
      // otherwise the count tus reported stays; resuming asks the server anyway
      return;
    }
    if (tasks.get(key)?.attempt === attempt && get(key)?.phase === 'paused') {
      set(key, { bytesUploaded: session.uploadedBytes });
    }
  }

  function blank(file: File, options: StartOptions): UploadState {
    return {
      key: `upload-${++keySeq}`,
      phase: 'uploading',
      fileName: file.name,
      title: options.title,
      bytesUploaded: 0,
      bytesTotal: file.size,
      speed: 0,
      assetId: null,
      uploadId: null,
      job: null,
      failedDuring: null,
      error: null,
      canResume: false,
      assetGone: false,
      authFailed: false,
      pollStopped: false,
      cleanup: null,
      notice: null,
    };
  }

  return {
    getState: () => state,

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    /** Whether a transfer is running, so a new one has to wait. */
    busy: () => state.uploads.some(isTransferring),

    /** Start a transfer; returns the upload's key. */
    start(file: File, options: StartOptions): string {
      if (state.uploads.some(isTransferring)) {
        throw new Error('An upload is already in progress');
      }
      // the sdk resumes an unfinished upload of the same file and metadata, so
      // a failed card for it would describe the same upload twice
      const replaced = state.uploads.filter((u) => {
        const t = tasks.get(u.key);
        return (
          u.phase === 'failed' &&
          u.failedDuring === 'upload' &&
          t &&
          sameFile(t.file, file) &&
          sameOptions(t.options, options)
        );
      });
      for (const u of replaced) tasks.delete(u.key);
      const entry = blank(file, options);
      tasks.set(entry.key, {
        file,
        options,
        attempt: null,
        samples: [],
        pollTimer: undefined,
        pollGen: 0,
        jobWaitSince: null,
      });
      state = {
        ...state,
        uploads: [entry, ...state.uploads.filter((u) => !replaced.includes(u))],
      };
      emit();
      runAttempt(entry.key);
      return entry.key;
    },

    async pause(key: string) {
      const task = tasks.get(key);
      const attempt = task?.attempt;
      if (!attempt || get(key)?.phase !== 'uploading') return;
      await attempt.handle.pause();
      // the last chunk may have landed, or a cancel come in, while pausing
      if (task.attempt !== attempt || attempt.cancelled || attempt.succeeded) return;
      if (get(key)?.phase !== 'uploading') return;
      task.samples = [];
      set(key, { phase: 'paused', speed: 0 });
      await showCommittedBytes(key, attempt);
    },

    resume(key: string) {
      const attempt = tasks.get(key)?.attempt;
      if (!attempt || get(key)?.phase !== 'paused') return;
      attempt.handle.resume();
      set(key, { phase: 'uploading' });
    },

    /** Stop the transfer; the server drops the partial file and the asset. */
    async cancel(key: string) {
      const task = tasks.get(key);
      const attempt = task?.attempt;
      const phase = get(key)?.phase;
      if (!attempt || (phase !== 'uploading' && phase !== 'paused')) return;
      attempt.cancelled = true;
      set(key, { phase: 'cancelled', speed: 0, cleanup: 'pending', error: null });
      try {
        await attempt.handle.abort();
      } catch (err) {
        if (task.attempt !== attempt) return;
        task.attempt = null;
        if (statusOf(err) === 401) {
          authFailed(key, { cleanup: 'failed' });
          return;
        }
        set(key, {
          cleanup: 'failed',
          error: `The server did not confirm removing the partial upload: ${message(err)}`,
        });
        return;
      }
      if (task.attempt !== attempt) return;
      if (attempt.succeeded) {
        // abort does nothing once tus reported success, so the upload finished
        // and its asset is still there
        await transferred(key, attempt, 'The upload finished before it could be cancelled.');
        return;
      }
      task.attempt = null;
      const created = await attempt.handle.uploadId.then(
        () => true,
        () => false,
      );
      set(key, { cleanup: created ? 'done' : 'nothing' });
      assetChanged(key);
    },

    /** Ask the server again to remove a cancelled upload it did not remove. */
    async retryCleanup(key: string) {
      const u = get(key);
      if (!u || u.phase !== 'cancelled' || u.cleanup !== 'failed' || !u.uploadId) return;
      set(key, { cleanup: 'pending', error: null });
      try {
        await client.uploads.cancel(u.uploadId);
      } catch (err) {
        const status = statusOf(err);
        if (status === 401) {
          authFailed(key, { cleanup: 'failed' });
          return;
        }
        if (status === 409) {
          // the upload finished after all, so there is an asset to follow
          set(key, {
            phase: 'processing',
            cleanup: null,
            notice: 'The upload finished before it could be cancelled.',
          });
          assetChanged(key);
          if (get(key)?.assetId) startPolling(key);
          return;
        }
        if (status !== 404) {
          set(key, {
            cleanup: 'failed',
            error: `The server did not confirm removing the partial upload: ${message(err)}`,
          });
          return;
        }
        // 404: already gone, which is what was asked for
      }
      set(key, { cleanup: 'done' });
      assetChanged(key);
    },

    /** Pick a failed transfer up again; the sdk resumes from what the server holds. */
    resumeTransfer(key: string) {
      const u = get(key);
      if (!u || u.phase !== 'failed' || u.failedDuring !== 'upload' || !u.canResume) return;
      if (state.uploads.some(isTransferring)) throw new Error('An upload is already in progress');
      set(key, { phase: 'uploading', failedDuring: null, error: null, canResume: false, speed: 0 });
      runAttempt(key);
    },

    /** Re-run processing for an asset that failed after its bytes arrived. */
    async retryProcessing(key: string) {
      const u = get(key);
      if (!u?.assetId || u.phase !== 'failed' || u.failedDuring !== 'processing' || u.assetGone) {
        return;
      }
      stopPolling(key);
      const gen = tasks.get(key)!.pollGen;
      set(key, { phase: 'processing', failedDuring: null, error: null, job: null });
      try {
        await client.assets.retry(u.assetId);
      } catch (err) {
        if (tasks.get(key)?.pollGen !== gen) return;
        if (statusOf(err) === 401) {
          authFailed(key, { phase: 'failed', failedDuring: 'processing' });
          return;
        }
        set(key, { phase: 'failed', failedDuring: 'processing', error: message(err) });
        return;
      }
      if (tasks.get(key)?.pollGen !== gen) return;
      assetChanged(key);
      startPolling(key);
    },

    /** Poll processing again after it gave up. */
    refresh(key: string) {
      const u = get(key);
      if (!u || u.phase !== 'processing' || !u.pollStopped) return;
      set(key, { error: null });
      startPolling(key);
    },

    /** Drop a finished, failed or cancelled upload from the list. */
    dismiss(key: string) {
      const u = get(key);
      if (!u || isTransferring(u) || u.cleanup === 'pending') return;
      stopPolling(key);
      tasks.delete(key);
      state = { ...state, uploads: state.uploads.filter((x) => x.key !== key) };
      emit();
    },
  };
}

export type UploadStore = ReturnType<typeof createUploadStore>;

export function useUploads(store: UploadStore): UploadsState {
  return useSyncExternalStore(store.subscribe, store.getState);
}
