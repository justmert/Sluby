import { useSyncExternalStore } from 'react';
import type { AccessTier, AssetUploadHandle, ProcessingJob, SlubyClient } from '@sluby/sdk';

// tus chunk size the studio uploads with; the progress strip draws these
export const CHUNK_SIZE = 8 * 1024 * 1024;
const POLL_MS = 2_000;
// the sdk reads the asset id with a HEAD right after creation; once the bytes
// are all sent it has had ample time, so do not wait on it forever
const ASSET_ID_GRACE_MS = 10_000;

export type UploadPhase =
  'idle' | 'uploading' | 'paused' | 'processing' | 'ready' | 'failed' | 'cancelled';

export interface UploadState {
  phase: UploadPhase;
  fileName: string | null;
  title: string;
  bytesUploaded: number;
  bytesTotal: number;
  /** Bytes per second over the last few seconds of transfer. */
  speed: number;
  assetId: string | null;
  job: ProcessingJob | null;
  /** Where it failed: the byte transfer, or the pipeline after it. */
  failedDuring: 'upload' | 'processing' | null;
  error: string | null;
}

const INITIAL: UploadState = {
  phase: 'idle',
  fileName: null,
  title: '',
  bytesUploaded: 0,
  bytesTotal: 0,
  speed: 0,
  assetId: null,
  job: null,
  failedDuring: null,
  error: null,
};

export interface StartOptions {
  title: string;
  description?: string;
  accessTier?: AccessTier;
}

type Sample = { at: number; bytes: number };

/**
 * One studio upload at a time, kept outside react so it survives navigating
 * between studio pages: the tus transfer and the processing poll keep going
 * and the upload page picks the state back up when it mounts again.
 */
export function createUploadStore(client: SlubyClient, now: () => number = Date.now) {
  let state: UploadState = INITIAL;
  let handle: AssetUploadHandle | null = null;
  let samples: Sample[] = [];
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  // bumps on every new upload, so callbacks from an old one are ignored
  let generation = 0;
  const listeners = new Set<() => void>();

  const set = (patch: Partial<UploadState>) => {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };

  const stopPolling = () => {
    clearTimeout(pollTimer);
    pollTimer = undefined;
  };

  const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

  const poll = async (gen: number, assetId: string) => {
    if (gen !== generation) return;
    try {
      const job = await client.assets.processing(assetId);
      if (gen !== generation) return;
      if (job.status === 'completed') {
        set({ job, phase: 'ready' });
        return;
      }
      if (job.status === 'failed') {
        set({
          job,
          phase: 'failed',
          failedDuring: 'processing',
          error: job.errorMessage ?? 'Processing failed',
        });
        return;
      }
      set({ job, error: null });
    } catch (err) {
      if (gen !== generation) return;
      // the job row appears once the upload is handed to the queue; until then
      // a 404 just means "not yet", anything else is worth showing
      const status = (err as { statusCode?: number }).statusCode;
      if (status !== 404) set({ error: `Could not read processing status: ${message(err)}` });
    }
    pollTimer = setTimeout(() => void poll(gen, assetId), POLL_MS);
  };

  const startPolling = (gen: number, assetId: string) => {
    stopPolling();
    void poll(gen, assetId);
  };

  const recordProgress = (bytes: number, total: number) => {
    const t = now();
    samples.push({ at: t, bytes });
    // a short sliding window keeps the speed responsive without jitter
    samples = samples.filter((s) => t - s.at <= 5_000);
    const first = samples[0];
    const elapsed = (t - first.at) / 1000;
    const speed = elapsed > 0 ? (bytes - first.bytes) / elapsed : state.speed;
    set({ bytesUploaded: bytes, bytesTotal: total, speed: Math.max(0, speed) });
  };

  return {
    getState: () => state,

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    start(file: File, options: StartOptions) {
      if (state.phase === 'uploading' || state.phase === 'paused') {
        throw new Error('An upload is already in progress');
      }
      stopPolling();
      const gen = ++generation;
      samples = [];
      set({
        ...INITIAL,
        phase: 'uploading',
        fileName: file.name,
        title: options.title,
        bytesTotal: file.size,
      });

      const h = client.uploads.upload(file, {
        title: options.title,
        description: options.description,
        accessTier: options.accessTier,
        chunkSize: CHUNK_SIZE,
        onProgress: (_pct, bytes, total) => {
          if (gen === generation) recordProgress(bytes, total);
        },
      });
      handle = h;

      h.assetId.then(
        (assetId) => {
          if (gen === generation) set({ assetId });
        },
        () => {
          // the upload's own rejection below reports the failure
        },
      );

      h.then(
        async () => {
          if (gen !== generation) return;
          handle = null;
          let graceTimer: ReturnType<typeof setTimeout> | undefined;
          const assetId = await Promise.race([
            h.assetId.catch(() => null),
            new Promise<null>((resolve) => {
              graceTimer = setTimeout(() => resolve(null), ASSET_ID_GRACE_MS);
            }),
          ]);
          clearTimeout(graceTimer);
          if (gen !== generation) return;
          if (!assetId) {
            set({
              phase: 'failed',
              failedDuring: 'upload',
              error: 'The upload finished but the server did not report which asset it created.',
            });
            return;
          }
          set({ phase: 'processing', assetId, bytesUploaded: state.bytesTotal, speed: 0 });
          startPolling(gen, assetId);
        },
        (err: unknown) => {
          if (gen !== generation) return;
          handle = null;
          if (state.phase === 'cancelled') return;
          set({ phase: 'failed', failedDuring: 'upload', error: message(err), speed: 0 });
        },
      );
    },

    async pause() {
      if (!handle || state.phase !== 'uploading') return;
      await handle.pause();
      samples = [];
      set({ phase: 'paused', speed: 0 });
    },

    resume() {
      if (!handle || state.phase !== 'paused') return;
      handle.resume();
      set({ phase: 'uploading' });
    },

    /** Stop the transfer; the server drops the partial file and the asset. */
    async cancel() {
      const h = handle;
      if (!h) return;
      handle = null;
      set({ phase: 'cancelled', speed: 0 });
      await h.abort();
    },

    /** Re-run processing for an asset that failed after its bytes arrived. */
    async retryProcessing() {
      const assetId = state.assetId;
      if (!assetId || state.failedDuring !== 'processing') return;
      const gen = ++generation;
      set({ phase: 'processing', failedDuring: null, error: null, job: null });
      try {
        await client.assets.retry(assetId);
      } catch (err) {
        if (gen === generation) {
          set({ phase: 'failed', failedDuring: 'processing', error: message(err) });
        }
        return;
      }
      startPolling(gen, assetId);
    },

    reset() {
      if (state.phase === 'uploading' || state.phase === 'paused') return;
      generation++;
      stopPolling();
      handle = null;
      samples = [];
      set(INITIAL);
    },
  };
}

export type UploadStore = ReturnType<typeof createUploadStore>;

export function useUploadState(store: UploadStore): UploadState {
  return useSyncExternalStore(store.subscribe, store.getState);
}
