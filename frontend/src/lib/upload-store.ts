import { useSyncExternalStore } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { AccessTier, AssetUploadHandle, ProcessingJob, SlubyClient } from '@sluby/sdk';
import { failureInfo, jobStep, type Job } from '@/components/asset/processing';
import { retryAfterOf } from './api-client';
import { describeError, errorText } from './errors';
import { formatBytes } from './formatters';
import { fileFingerprint, type SharedUpload, type UploadTabs } from './upload-tabs';

// tus chunk size the studio uploads with; the progress strip draws these
export const CHUNK_SIZE = 8 * 1024 * 1024;
// processing is read every 2 s while the job moves and every 10 s once it has
// not changed for 10 s, such as a video waiting its turn for the sia uploader
// (FLW-26): at most 6 readings a minute for a job that sits still
const FAST_POLL_MS = 2_000;
const SLOW_POLL_MS = 10_000;
const SETTLE_MS = 10_000;
// a 429 can ask for a long wait; the card still checks at least this often
const MAX_WAIT_MS = 30_000;
// the sdk reads the asset id with a HEAD right after creation; once the bytes
// are all sent it has had ample time, so do not wait on it forever
const ASSET_ID_GRACE_MS = 10_000;
// the server creates the processing job before it answers the last chunk, so
// a job that is still missing after this long is not coming on its own
const JOB_WAIT_MS = 60_000;
// each pipeline stage runs at most this many times before the video fails
// (attempts in backend/src/queue/bull-config.ts)
export const STAGE_ATTEMPTS = 3;

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
  /** The file's identity across tabs and page loads (name, type, size, date). */
  fingerprint: string;
  title: string;
  accessTier: AccessTier;
  bytesUploaded: number;
  bytesTotal: number;
  /** Bytes per second over the last few seconds of transfer. */
  speed: number;
  assetId: string | null;
  /** The tus upload id, once the server created the upload. */
  uploadId: string | null;
  job: Job | null;
  /** Where it failed: the byte transfer, or the pipeline after it. */
  failedDuring: 'upload' | 'processing' | null;
  error: string | null;
  /** The raw text behind `error`, for a Details disclosure only. */
  errorDetail: string | null;
  /** The transfer stopped on something worth trying again (network, server error). */
  canResume: boolean;
  /** The transfer stopped because the connection dropped; it resumes on its own once online. */
  lostConnection: boolean;
  /** The asset was deleted while it was processing. */
  assetGone: boolean;
  /** The session ended (401); nothing works until the user signs in again. */
  authFailed: boolean;
  /** The processing poll gave up; `refresh` starts it again. */
  pollStopped: boolean;
  /** The last processing reading failed on something passing (429, network); the next one is coming. */
  checking: boolean;
  /** Which run of the current stage this is, once it is not the first: "Attempt 2 of 3". */
  attempt: { n: number; of: number } | null;
  /**
   * For an upload picked up from an earlier page load: the bytes the server
   * already held, as the sdk reported when it continued. Null until then, and
   * when the sdk had to start over.
   */
  resumedFrom: number | null;
  /**
   * For a cancelled upload: whether the server removed what it had. `nothing`
   * means the upload was cancelled before the server created it.
   */
  cleanup: 'pending' | 'done' | 'failed' | 'nothing' | null;
  /** Something the user should know that is not an error. */
  notice: string | null;
  /**
   * Time spent actually sending bytes, pauses left out. It grows while the
   * transfer runs and stays put once the bytes are all sent.
   */
  activeMs: number;
}

/** A file waiting for the running transfer to finish. */
export interface QueuedUpload {
  key: string;
  fileName: string;
  title: string;
  bytesTotal: number;
}

/** A picked file whose details are still being filled in. */
export interface Draft {
  id: string;
  file: File;
  fingerprint: string;
  title: string;
}

/** What the details form sets for every draft at once. */
export interface DraftOptions {
  /** Only used when there is a single draft. */
  description: string;
  accessTier: AccessTier;
}

export interface UploadsState {
  /** Newest first. At most one of them is transferring. */
  uploads: UploadState[];
  /** Files waiting their turn, in the order they will start. */
  queued: QueuedUpload[];
  /**
   * The queue stopped because a transfer failed in a way resuming can fix; it
   * starts again when that upload is resumed or dismissed, or on
   * `continueQueue`.
   */
  queueHeld: boolean;
  /** The browser is offline, so queued files wait for the connection. */
  offline: boolean;
  /** Files picked but not started, kept while the sheet is closed. */
  drafts: Draft[];
  draftOptions: DraftOptions;
  /** The largest file the server takes, in bytes (tus Tus-Max-Size), once read. */
  limit: number | null;
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
  /** The tus upload id this is meant to continue, for an unfinished upload from an earlier page load. */
  resumeUploadId?: string;
}

export interface Visibility {
  hidden(): boolean;
  subscribe(listener: () => void): () => void;
}

type Target = Pick<Window, 'addEventListener' | 'removeEventListener'>;

export interface UploadStoreOptions {
  now?: () => number;
  /** Called once per 401, so the app can send the user back to sign-in. */
  onAuthFailure?: () => void;
  /** Where to register the leave-page warning; none outside a browser. */
  unloadTarget?: Target | null;
  /**
   * Reads processing through this cache, keyed like the video page's query,
   * so one video has one poller however many places show it.
   */
  queryClient?: QueryClient;
  /** Keeps another tab from sending the same file. Without it, only this tab is checked. */
  tabs?: UploadTabs | null;
  /** Where `online` fires; none outside a browser. */
  onlineTarget?: Target | null;
  isOnline?: () => boolean;
  /** Polls pause while the page is hidden. */
  visibility?: Visibility | null;
  /** Reads the server's upload limit (bytes), or null when it sets none. */
  readLimit?: (() => Promise<number | null>) | null;
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
  // waiting for the page to show again before the next reading
  parked: boolean;
  jobWaitSince: number | null;
  // when the job last changed, and what it looked like then
  lastChange: number;
  lastSignature: string | null;
  // the stage the attempt count is about, and its retry count when first seen running
  stageBase: { step: string; retryCount: number } | null;
  // active transfer time from earlier stretches, and when the current one began
  activeBase: number;
  segmentStart: number | null;
  // the cross-tab claim on the file while it is being sent
  claiming: boolean;
  release: (() => void) | null;
  // whether the sdk continued the upload it was meant to
  resumeConfirmed: boolean;
}

interface QueuedTask {
  entry: QueuedUpload;
  file: File;
  options: StartOptions;
}

const TRANSFERRING: readonly UploadPhase[] = ['uploading', 'paused', 'finishing'];

export const isTransferring = (u: UploadState) => TRANSFERRING.includes(u.phase);

const SESSION_ENDED = 'Your session ended. Sign in again to continue.';
export const OTHER_TAB = 'This file is already uploading in another tab.';
const OFFLINE_DROP = 'The connection dropped. The upload continues when you are back online.';
const SERVER_DROP = 'The connection to the server dropped.';

/** The HTTP status an sdk error carries, 0 for network and client-side errors. */
function statusOf(err: unknown): number {
  const status = (err as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === 'number' ? status : 0;
}

const isAbort = (err: unknown) => (err as { name?: string } | null)?.name === 'AbortError';

// a transfer that stopped on these can work on a second try
const retryable = (err: unknown) => {
  const s = statusOf(err);
  return s === 0 || s === 408 || s === 429 || s >= 500;
};

// a processing reading that failed on these is worth asking again soon
const passing = (status: number) =>
  status === 0 || status === 408 || status === 429 || status >= 500;

const sameFile = (a: File, b: File) =>
  a.name === b.name && a.size === b.size && a.type === b.type && a.lastModified === b.lastModified;

const sameOptions = (a: StartOptions, b: StartOptions) =>
  a.title === b.title &&
  (a.description ?? '') === (b.description ?? '') &&
  (a.accessTier ?? 'public') === (b.accessTier ?? 'public');

/** A first title from the file name: "product_walkthrough-v2.mov" reads "product walkthrough v2". */
export function titleFromFile(name: string): string {
  return (
    name
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .trim() || 'Untitled'
  );
}

/** "11.8 GB is over this server's 10.7 GB limit." */
export const overLimit = (size: number, limit: number) =>
  `${formatBytes(size)} is over this server's ${formatBytes(limit)} limit.`;

/**
 * A lead sentence and the reader's text for an error, without saying "Could
 * not" twice when the mapped text already starts with it.
 */
function led(lead: string, err: unknown): Pick<UploadState, 'error' | 'errorDetail'> {
  const info = describeError(err);
  return {
    error: /^could not/i.test(info.message) ? info.message : `${lead}. ${info.message}`,
    errorDetail: info.detail ?? null,
  };
}

/** What changed on a job between two readings, for the adaptive poll. */
const signature = (job: ProcessingJob) =>
  `${job.status}|${job.stage}|${job.progressPercent}|${job.retryCount}|${job.logs.length}`;

let keySeq = 0;
let draftSeq = 0;

/** What a compact progress indicator needs to know about all uploads at once. */
export interface UploadSummary {
  /** The upload sending bytes right now (or paused, or finishing), if any. */
  transferring: UploadState | null;
  /** Percent of the running transfer's bytes sent, 0 to 100, or null without one. */
  percent: number | null;
  /** Uploads whose bytes are in and that the server is still processing. */
  processing: number;
  queued: number;
  failed: number;
}

export function summarizeUploads(state: UploadsState): UploadSummary {
  const transferring = state.uploads.find(isTransferring) ?? null;
  return {
    transferring,
    percent:
      transferring && transferring.bytesTotal > 0
        ? Math.min(100, (transferring.bytesUploaded / transferring.bytesTotal) * 100)
        : transferring
          ? 0
          : null,
    processing: state.uploads.filter((u) => u.phase === 'processing').length,
    queued: state.queued.length,
    failed: state.uploads.filter((u) => u.phase === 'failed').length,
  };
}

function documentVisibility(): Visibility | null {
  if (typeof document === 'undefined') return null;
  return {
    hidden: () => document.visibilityState === 'hidden',
    subscribe(listener) {
      document.addEventListener('visibilitychange', listener);
      return () => document.removeEventListener('visibilitychange', listener);
    },
  };
}

/**
 * The studio's uploads, kept outside react so they survive navigating between
 * studio pages and closing the upload sheet: the drafts, the tus transfer, the
 * queue and the processing polls all live here. One transfer runs at a time;
 * earlier uploads stay listed while they process.
 */
export function createUploadStore(client: SlubyClient, opts: UploadStoreOptions = {}) {
  const now = opts.now ?? Date.now;
  const browser = typeof window !== 'undefined' ? window : null;
  const unloadTarget = opts.unloadTarget !== undefined ? opts.unloadTarget : browser;
  const onlineTarget = opts.onlineTarget !== undefined ? opts.onlineTarget : browser;
  const isOnline =
    opts.isOnline ?? (() => typeof navigator === 'undefined' || navigator.onLine !== false);
  const visibility = opts.visibility !== undefined ? opts.visibility : documentVisibility();
  const tabs = opts.tabs ?? null;
  const queryClient = opts.queryClient;

  let state: UploadsState = {
    uploads: [],
    queued: [],
    queueHeld: false,
    offline: false,
    drafts: [],
    draftOptions: { description: '', accessTier: 'public' },
    limit: null,
    assetVersion: 0,
  };
  const tasks = new Map<string, Task>();
  const waiting: QueuedTask[] = [];
  const seen = new Set<string>();
  let advancing = false;
  const listeners = new Set<() => void>();
  let guarding = false;
  let limitLoad: Promise<void> | null = null;

  // closing the tab drops the in-memory transfer, so ask first
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    e.preventDefault();
    // older safari only prompts when returnValue is set
    e.returnValue = '';
  };

  const syncUnloadGuard = () => {
    if (!unloadTarget) return;
    const needed =
      state.queued.length > 0 ||
      state.uploads.some((u) => isTransferring(u) || u.cleanup === 'pending');
    if (needed === guarding) return;
    guarding = needed;
    if (needed) unloadTarget.addEventListener('beforeunload', onBeforeUnload);
    else unloadTarget.removeEventListener('beforeunload', onBeforeUnload);
  };

  /** Tell the other tabs what this one is sending; bytes alone ride on the heartbeat. */
  const publish = () => {
    if (!tabs) return;
    const sending: SharedUpload[] = [];
    for (const u of state.uploads) {
      if (!isTransferring(u) || !tasks.get(u.key)?.release) continue;
      sending.push({
        fingerprint: u.fingerprint,
        uploadId: u.uploadId,
        title: u.title,
        fileName: u.fileName,
        bytesUploaded: u.bytesUploaded,
        bytesTotal: u.bytesTotal,
        paused: u.phase === 'paused',
      });
    }
    tabs.publish(sending);
  };

  const emit = () => {
    syncUnloadGuard();
    publish();
    listeners.forEach((l) => l());
    advance();
  };

  // the unfinished list is read from tus's records, which change as uploads
  // start, finish and are cancelled; it must never show a stale row (FLW-04)
  const unfinishedChanged = () => {
    void queryClient?.invalidateQueries({ queryKey: ['uploads', 'unfinished'] });
  };

  /** Start the next queued file once nothing is transferring. */
  function advance() {
    if (advancing || state.queueHeld || waiting.length === 0) return;
    if (state.uploads.some((u) => isTransferring(u) || u.authFailed)) return;
    if (!isOnline()) {
      if (!state.offline) {
        state = { ...state, offline: true };
        listeners.forEach((l) => l());
      }
      return;
    }
    advancing = true;
    try {
      const next = waiting.shift()!;
      state = { ...state, queued: state.queued.filter((q) => q.key !== next.entry.key) };
      begin(next.file, next.options, next.entry.key);
    } finally {
      advancing = false;
    }
  }

  const get = (key: string) => state.uploads.find((u) => u.key === key);

  const set = (key: string, patch: Partial<UploadState>) => {
    const old = get(key);
    if (!old) return;
    state = {
      ...state,
      uploads: state.uploads.map((u) => (u.key === key ? { ...u, ...patch } : u)),
    };
    if (patch.uploadId && patch.uploadId !== old.uploadId) seen.add(patch.uploadId);
    if (
      (patch.phase !== undefined && patch.phase !== old.phase) ||
      (patch.uploadId !== undefined && patch.uploadId !== old.uploadId)
    ) {
      unfinishedChanged();
    }
    emit();
  };

  const assetChanged = (key: string) => {
    if (!get(key)?.assetId) return;
    state = { ...state, assetVersion: state.assetVersion + 1 };
    emit();
  };

  const releaseClaim = (key: string) => {
    const task = tasks.get(key);
    if (!task?.release) return;
    const release = task.release;
    task.release = null;
    release();
    publish();
  };

  const authFailed = (key: string, patch: Partial<UploadState> = {}) => {
    stopPolling(key);
    releaseClaim(key);
    set(key, { ...patch, authFailed: true, error: SESSION_ENDED, canResume: false, speed: 0 });
    opts.onAuthFailure?.();
  };

  function stopPolling(key: string) {
    const task = tasks.get(key);
    if (!task) return;
    clearTimeout(task.pollTimer);
    task.pollTimer = undefined;
    task.parked = false;
    task.pollGen++;
  }

  function startPolling(key: string) {
    const task = tasks.get(key);
    if (!task) return;
    stopPolling(key);
    task.jobWaitSince = null;
    task.lastChange = now();
    task.lastSignature = null;
    set(key, { pollStopped: false, checking: false });
    void poll(key, task.pollGen);
  }

  function schedule(key: string, gen: number, waitMs = 0) {
    const task = tasks.get(key);
    if (!task || task.pollGen !== gen) return;
    if (visibility?.hidden()) {
      task.parked = true;
      return;
    }
    const pace = now() - task.lastChange < SETTLE_MS ? FAST_POLL_MS : SLOW_POLL_MS;
    task.pollTimer = setTimeout(() => void poll(key, gen), Math.max(pace, waitMs));
  }

  const readJob = (assetId: string): Promise<Job> =>
    queryClient
      ? queryClient.fetchQuery({
          // the same key the video page and the library read, so whichever
          // asks first answers the others for the next two seconds
          queryKey: ['assets', 'processing', assetId, 'processing'],
          queryFn: () => client.assets.processing(assetId),
          staleTime: FAST_POLL_MS - 100,
          retry: false,
        })
      : client.assets.processing(assetId);

  /** "Attempt 2 of 3" for the stage being run again, when the first reading of that stage was seen. */
  function attemptOf(task: Task, job: Job): UploadState['attempt'] {
    const step = jobStep(job);
    if (!step) return null;
    if (task.stageBase?.step !== step) {
      // a stage first seen mid-retry has an unknown count, so none is shown
      task.stageBase = job.status === 'retrying' ? null : { step, retryCount: job.retryCount };
      if (!task.stageBase) return null;
    }
    const n = job.retryCount - task.stageBase.retryCount + 1;
    return n > 1 ? { n: Math.min(n, STAGE_ATTEMPTS), of: STAGE_ATTEMPTS } : null;
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
          checking: false,
          error: 'This video was deleted before processing finished.',
        });
        assetChanged(key);
        return 'stop';
      }
      // could not tell; keep the last stage and ask again
      set(key, { checking: true });
      return 'continue';
    }
    if (task.pollGen !== gen) return 'stop';
    if (asset.status === 'ready') {
      set(key, { phase: 'ready', error: null, checking: false });
      assetChanged(key);
      return 'stop';
    }
    if (asset.status === 'failed') {
      set(key, {
        phase: 'failed',
        failedDuring: 'processing',
        checking: false,
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
        checking: false,
        error: 'Processing has not started after a minute. Check again, or open the video.',
      });
      return 'stop';
    }
    return 'continue';
  }

  async function poll(key: string, gen: number) {
    const task = tasks.get(key);
    const assetId = get(key)?.assetId;
    if (!task || !assetId || task.pollGen !== gen) return;
    if (visibility?.hidden()) {
      task.parked = true;
      return;
    }
    let waitMs = 0;
    try {
      const job = await readJob(assetId);
      if (task.pollGen !== gen) return;
      task.jobWaitSince = null;
      const sig = signature(job);
      if (sig !== task.lastSignature) {
        task.lastSignature = sig;
        task.lastChange = now();
      }
      if (job.status === 'completed') {
        releaseClaim(key);
        set(key, { job, phase: 'ready', error: null, checking: false, attempt: null });
        assetChanged(key);
        return;
      }
      if (job.status === 'failed') {
        set(key, {
          job,
          phase: 'failed',
          failedDuring: 'processing',
          checking: false,
          attempt: null,
          // the plain reason; the raw ffmpeg line stays on the job for Details (FLW-21)
          error: failureInfo(job).body,
        });
        assetChanged(key);
        return;
      }
      set(key, { job, error: null, checking: false, attempt: attemptOf(task, job) });
    } catch (err) {
      if (task.pollGen !== gen) return;
      const status = statusOf(err);
      if (status === 401) {
        authFailed(key);
        return;
      }
      if (status === 404) {
        if ((await explainMissingJob(key, assetId, gen)) === 'stop') return;
      } else if (passing(status)) {
        // keep the last stage on screen and say another reading is coming
        set(key, { checking: true });
        const after = retryAfterOf(err);
        if (after !== undefined) waitMs = Math.min(after * 1000, MAX_WAIT_MS);
      } else {
        // a client error does not go away by asking again
        stopPolling(key);
        set(key, {
          pollStopped: true,
          checking: false,
          ...led('Could not read the processing status', err),
        });
        return;
      }
    }
    schedule(key, gen, waitMs);
  }

  const unsubscribeVisibility = visibility?.subscribe(() => {
    if (visibility.hidden()) return;
    for (const [key, task] of tasks) {
      if (!task.parked) continue;
      task.parked = false;
      void poll(key, task.pollGen);
    }
  });

  /** Close the running stretch of transfer time, e.g. on pause, failure or the last byte. */
  const closeSegment = (key: string) => {
    const task = tasks.get(key);
    if (!task || task.segmentStart === null) return;
    task.activeBase += now() - task.segmentStart;
    task.segmentStart = null;
    set(key, { activeMs: task.activeBase });
  };

  const openSegment = (key: string) => {
    const task = tasks.get(key);
    if (task && task.segmentStart === null) task.segmentStart = now();
  };

  const recordProgress = (key: string, bytes: number, total: number) => {
    const task = tasks.get(key)!;
    const t = now();
    const activeMs = task.activeBase + (task.segmentStart === null ? 0 : t - task.segmentStart);
    task.samples.push({ at: t, bytes });
    // a short sliding window keeps the speed responsive without jitter
    task.samples = task.samples.filter((s) => t - s.at <= 5_000);
    const first = task.samples[0];
    const elapsed = (t - first.at) / 1000;
    const speed = elapsed > 0 ? (bytes - first.bytes) / elapsed : (get(key)?.speed ?? 0);
    const patch: Partial<UploadState> = {
      bytesUploaded: bytes,
      bytesTotal: total,
      speed: Math.max(0, speed),
      activeMs,
    };
    // the first bytes of a confirmed resume start at what the server held
    if (task.resumeConfirmed && get(key)?.resumedFrom === null) patch.resumedFrom = bytes;
    set(key, patch);
  };

  /** All bytes are on the server: wait for the asset id, then follow processing. */
  async function transferred(key: string, attempt: Attempt, notice: string | null = null) {
    closeSegment(key);
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
    // every byte is in, so no other tab can send this file over it any more
    releaseClaim(key);
    if (!assetId) {
      set(key, {
        phase: 'failed',
        failedDuring: 'upload',
        error: 'The upload finished but the server did not report which video it created.',
      });
      return;
    }
    set(key, { phase: 'processing', assetId });
    assetChanged(key);
    startPolling(key);
  }

  /** The server did not confirm a cancel: say so, with what it answered under Details. */
  const cleanupError = (err: unknown): Pick<UploadState, 'error' | 'errorDetail'> => ({
    error: 'The server did not confirm it removed the partial file.',
    errorDetail: describeError(err).detail ?? null,
  });

  /** Why a transfer stopped, in the reader's words. */
  function transferError(
    err: unknown,
  ): Pick<UploadState, 'error' | 'errorDetail' | 'lostConnection'> {
    const status = statusOf(err);
    const info = describeError(err);
    const errorDetail = info.detail ?? null;
    if (status === 0 && !isAbort(err)) {
      const offline = !isOnline();
      return { error: offline ? OFFLINE_DROP : SERVER_DROP, errorDetail, lostConnection: offline };
    }
    if (status === 413 && state.limit !== null) {
      return {
        error: `This file is larger than the server's upload limit (${formatBytes(state.limit)}).`,
        errorDetail,
        lostConnection: false,
      };
    }
    return { error: info.message, errorDetail, lostConnection: false };
  }

  function runAttempt(key: string) {
    const task = tasks.get(key)!;
    task.samples = [];
    task.segmentStart = null;
    openSegment(key);
    const expected = task.options.resumeUploadId;
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
        if (task.attempt !== attempt) return;
        if (expected && uploadId === expected) task.resumeConfirmed = true;
        set(key, { uploadId });
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
        closeSegment(key);
        // the file is free again: another tab, or a later resume here, may take it
        releaseClaim(key);
        if (statusOf(err) === 401) {
          authFailed(key, { phase: 'failed', failedDuring: 'upload' });
          return;
        }
        const canResume = !isAbort(err) && retryable(err);
        // whatever broke this transfer would likely break the next one too,
        // but a failure resuming cannot fix has nothing to wait for (FLW-46)
        if (canResume && state.queued.length > 0) state = { ...state, queueHeld: true };
        set(key, {
          phase: 'failed',
          failedDuring: 'upload',
          ...transferError(err),
          canResume,
          speed: 0,
        });
      },
    );
  }

  /** Claim the file across tabs, then send it; refused when another tab sends it. */
  function claimAndRun(key: string) {
    const task = tasks.get(key);
    if (!task) return;
    if (!tabs) {
      runAttempt(key);
      return;
    }
    task.claiming = true;
    tabs.claim(fileFingerprint(task.file)).then(
      (release) => {
        task.claiming = false;
        const u = get(key);
        if (tasks.get(key) !== task || u?.phase !== 'uploading') {
          // cancelled or dismissed while waiting for the claim
          release?.();
          return;
        }
        if (!release) {
          set(key, {
            phase: 'failed',
            failedDuring: 'upload',
            error: OTHER_TAB,
            canResume: false,
            speed: 0,
          });
          return;
        }
        task.release = release;
        runAttempt(key);
        publish();
      },
      (err: unknown) => {
        task.claiming = false;
        // web locks refused the request itself; the browser blocks them here
        set(key, {
          phase: 'failed',
          failedDuring: 'upload',
          error: errorText(err),
          canResume: true,
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
      fingerprint: fileFingerprint(file),
      title: options.title,
      accessTier: options.accessTier ?? 'public',
      bytesUploaded: 0,
      bytesTotal: file.size,
      speed: 0,
      assetId: null,
      uploadId: null,
      job: null,
      failedDuring: null,
      error: null,
      errorDetail: null,
      canResume: false,
      lostConnection: false,
      assetGone: false,
      authFailed: false,
      pollStopped: false,
      checking: false,
      attempt: null,
      resumedFrom: null,
      cleanup: null,
      notice: null,
      activeMs: 0,
    };
  }

  function begin(file: File, options: StartOptions, key?: string): string {
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
    const entry = { ...blank(file, options), ...(key ? { key } : {}) };
    tasks.set(entry.key, {
      file,
      options,
      attempt: null,
      samples: [],
      pollTimer: undefined,
      pollGen: 0,
      parked: false,
      jobWaitSince: null,
      lastChange: now(),
      lastSignature: null,
      stageBase: null,
      activeBase: 0,
      segmentStart: null,
      claiming: false,
      release: null,
      resumeConfirmed: false,
    });
    const tooLarge = state.limit !== null && file.size > state.limit;
    const started: UploadState = tooLarge
      ? {
          ...entry,
          phase: 'failed',
          failedDuring: 'upload',
          error: overLimit(file.size, state.limit!),
        }
      : entry;
    state = {
      ...state,
      uploads: [started, ...state.uploads.filter((u) => !replaced.includes(u))],
    };
    emit();
    // refused before any request: the server would answer 413 after the first chunk
    if (!tooLarge) claimAndRun(entry.key);
    return entry.key;
  }

  /** The connection is back: queued files go on, and a transfer it cut off continues. */
  const onOnline = () => {
    const cut = state.uploads.find(
      (u) => u.phase === 'failed' && u.failedDuring === 'upload' && u.lostConnection,
    );
    if (state.offline) state = { ...state, offline: false };
    if (cut && !state.uploads.some(isTransferring)) {
      resumeTransfer(cut.key);
      return;
    }
    emit();
  };
  onlineTarget?.addEventListener('online', onOnline);

  /** Pick a failed transfer up again; the sdk resumes from what the server holds. */
  function resumeTransfer(key: string) {
    const u = get(key);
    if (!u || u.phase !== 'failed' || u.failedDuring !== 'upload' || !u.canResume) return;
    if (state.uploads.some(isTransferring)) throw new Error('An upload is already in progress');
    // the queue goes on after this one, the way it would have without the failure
    state = { ...state, queueHeld: false };
    set(key, {
      phase: 'uploading',
      failedDuring: null,
      error: null,
      errorDetail: null,
      canResume: false,
      lostConnection: false,
      speed: 0,
    });
    claimAndRun(key);
  }

  function enqueue(file: File, options: StartOptions): string {
    if (
      !state.uploads.some(isTransferring) &&
      waiting.length === 0 &&
      !state.queueHeld &&
      isOnline()
    ) {
      return begin(file, options);
    }
    const entry: QueuedUpload = {
      key: `upload-${++keySeq}`,
      fileName: file.name,
      title: options.title,
      bytesTotal: file.size,
    };
    waiting.push({ entry, file, options });
    state = { ...state, queued: [...state.queued, entry] };
    emit();
    return entry.key;
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

    /** Whether this tab started or continued this tus upload, so it is never listed as unfinished. */
    hasSeen: (uploadId: string) => seen.has(uploadId),

    /** Read the server's upload limit once; later calls wait for the same read. */
    loadLimit(): Promise<void> {
      if (!opts.readLimit) return Promise.resolve();
      limitLoad ??= opts.readLimit().then(
        (limit) => {
          state = { ...state, limit };
          emit();
        },
        (err: unknown) => {
          // the server still refuses an oversized file; this only checks early
          console.warn('upload store: could not read the upload limit', err);
          limitLoad = null;
        },
      );
      return limitLoad;
    },

    /** Start a transfer; returns the upload's key. */
    start(file: File, options: StartOptions): string {
      if (state.uploads.some(isTransferring)) {
        throw new Error('An upload is already in progress');
      }
      return begin(file, options);
    },

    /**
     * Start a transfer now, or line it up behind the running one. Returns
     * the key the upload will have, queued or not.
     */
    enqueue,

    /** Take a file out of the queue before it started. */
    removeQueued(key: string) {
      const i = waiting.findIndex((w) => w.entry.key === key);
      if (i < 0) return;
      waiting.splice(i, 1);
      const queued = state.queued.filter((q) => q.key !== key);
      state = { ...state, queued, queueHeld: queued.length > 0 && state.queueHeld };
      emit();
    },

    /** Let a queue that stopped on a failed transfer go on. */
    continueQueue() {
      if (!state.queueHeld) return;
      state = { ...state, queueHeld: false };
      emit();
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
      closeSegment(key);
      set(key, { phase: 'paused', speed: 0 });
      await showCommittedBytes(key, attempt);
    },

    resume(key: string) {
      const attempt = tasks.get(key)?.attempt;
      if (!attempt || get(key)?.phase !== 'paused') return;
      attempt.handle.resume();
      openSegment(key);
      set(key, { phase: 'uploading' });
    },

    /** Stop the transfer; the server drops the partial file and the asset. */
    async cancel(key: string) {
      const task = tasks.get(key);
      const attempt = task?.attempt;
      const phase = get(key)?.phase;
      if (phase !== 'uploading' && phase !== 'paused') return;
      if (!attempt) {
        // still waiting for the cross-tab claim: nothing reached the server
        if (!task?.claiming) return;
        set(key, { phase: 'cancelled', speed: 0, cleanup: 'nothing', error: null });
        return;
      }
      attempt.cancelled = true;
      closeSegment(key);
      set(key, { phase: 'cancelled', speed: 0, cleanup: 'pending', error: null });
      try {
        await attempt.handle.abort();
      } catch (err) {
        if (task.attempt !== attempt) return;
        task.attempt = null;
        releaseClaim(key);
        if (statusOf(err) === 401) {
          authFailed(key, { cleanup: 'failed' });
          return;
        }
        set(key, { cleanup: 'failed', ...cleanupError(err) });
        return;
      }
      if (task.attempt !== attempt) return;
      if (attempt.succeeded) {
        // abort does nothing once tus reported success, so the upload finished
        // and its asset is still there
        await transferred(key, attempt, 'The upload finished before it could be canceled.');
        return;
      }
      task.attempt = null;
      releaseClaim(key);
      const created = await attempt.handle.uploadId.then(
        () => true,
        () => false,
      );
      set(key, { cleanup: created ? 'done' : 'nothing' });
      unfinishedChanged();
      assetChanged(key);
    },

    /** Ask the server again to remove a cancelled upload it did not remove. */
    async retryCleanup(key: string) {
      const u = get(key);
      if (!u || u.phase !== 'cancelled' || u.cleanup !== 'failed' || !u.uploadId) return;
      set(key, { cleanup: 'pending', error: null, errorDetail: null });
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
            notice: 'The upload finished before it could be canceled.',
          });
          assetChanged(key);
          if (get(key)?.assetId) startPolling(key);
          return;
        }
        if (status !== 404) {
          set(key, { cleanup: 'failed', ...cleanupError(err) });
          return;
        }
        // 404: already gone, which is what was asked for
      }
      set(key, { cleanup: 'done' });
      unfinishedChanged();
      assetChanged(key);
    },

    resumeTransfer,

    /** Re-run processing for an asset that failed after its bytes arrived. */
    async retryProcessing(key: string) {
      const u = get(key);
      if (!u?.assetId || u.phase !== 'failed' || u.failedDuring !== 'processing' || u.assetGone) {
        return;
      }
      stopPolling(key);
      const task = tasks.get(key)!;
      const gen = task.pollGen;
      // a new run: its attempts count from one again
      task.stageBase = null;
      set(key, { phase: 'processing', failedDuring: null, error: null, job: null, attempt: null });
      try {
        await client.assets.retry(u.assetId);
      } catch (err) {
        if (tasks.get(key)?.pollGen !== gen) return;
        if (statusOf(err) === 401) {
          authFailed(key, { phase: 'failed', failedDuring: 'processing' });
          return;
        }
        set(key, { phase: 'failed', failedDuring: 'processing', ...led('Could not retry', err) });
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
      releaseClaim(key);
      tasks.delete(key);
      const uploads = state.uploads.filter((x) => x.key !== key);
      // dismissing the failure that held the queue lets it go on
      const held = uploads.some(
        (x) => x.phase === 'failed' && x.failedDuring === 'upload' && x.canResume,
      );
      state = { ...state, uploads, queueHeld: state.queueHeld && held };
      unfinishedChanged();
      emit();
    },

    /** Add picked files as drafts; returns their ids. */
    addDrafts(files: File[]): string[] {
      const added = files.map((file) => ({
        id: `draft-${++draftSeq}`,
        file,
        fingerprint: fileFingerprint(file),
        title: titleFromFile(file.name),
      }));
      state = { ...state, drafts: [...state.drafts, ...added] };
      emit();
      return added.map((d) => d.id);
    },

    updateDraft(id: string, patch: Pick<Draft, 'title'>) {
      if (!state.drafts.some((d) => d.id === id)) return;
      state = {
        ...state,
        drafts: state.drafts.map((d) => (d.id === id ? { ...d, ...patch } : d)),
      };
      emit();
    },

    removeDraft(id: string) {
      state = { ...state, drafts: state.drafts.filter((d) => d.id !== id) };
      emit();
    },

    clearDrafts() {
      state = { ...state, drafts: [], draftOptions: { ...state.draftOptions, description: '' } };
      emit();
    },

    setDraftOptions(patch: Partial<DraftOptions>) {
      state = { ...state, draftOptions: { ...state.draftOptions, ...patch } };
      emit();
    },

    /**
     * Start every draft (queued behind each other) with the shared options,
     * and clear them. A single draft gets the description. Returns the keys.
     */
    startDrafts(): string[] {
      const { drafts, draftOptions } = state;
      const single = drafts.length === 1;
      // cleared first, so the sheet's form gives way as the rows appear
      state = { ...state, drafts: [], draftOptions: { ...draftOptions, description: '' } };
      const keys = drafts.map((d) =>
        enqueue(d.file, {
          title: d.title.trim(),
          description: single ? draftOptions.description.trim() : undefined,
          accessTier: draftOptions.accessTier,
        }),
      );
      emit();
      return keys;
    },

    /** Stop listening to the page; for tests and hot reload. */
    dispose() {
      onlineTarget?.removeEventListener('online', onOnline);
      unsubscribeVisibility?.();
      for (const key of tasks.keys()) stopPolling(key);
    },
  };
}

export type UploadStore = ReturnType<typeof createUploadStore>;

export function useUploads(store: UploadStore): UploadsState {
  return useSyncExternalStore(store.subscribe, store.getState);
}
