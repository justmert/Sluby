import type { ProcessingJob, ProcessingStage, RetryStage, VideoAsset } from '@sluby/sdk';
import type { StatusTone } from '@/components/shared/status';

/*
 * the one place a processing job becomes words, a tone and a percent. the
 * video page, the library, the overview and the upload sheet all read it
 * here, so they cannot disagree again (FLW-08, FLW-21, FLW-22).
 */

/**
 * A job as GET /assets/{id}/processing answers it. `retryable` comes with
 * plan item B-15; until the server sends it, failureInfo decides from the
 * error message.
 */
export type Job = ProcessingJob & { retryable?: boolean };

/** The four steps a video goes through, as the processing steps name and explain them. */
export const PIPELINE_STEPS = [
  {
    key: 'upload',
    label: 'Upload',
    detail: 'The file is sent to this server and resumes if interrupted',
  },
  {
    key: 'transcode',
    label: 'Transcode',
    detail: 'Converted into several qualities for streaming',
  },
  {
    key: 'store',
    label: 'Store on Sia',
    detail: 'Video, playlists and thumbnails are stored on Sia',
  },
  { key: 'publish', label: 'Publish', detail: 'The video becomes playable' },
] as const;

export type PipelineStep = (typeof PIPELINE_STEPS)[number]['key'];

/** Live label for each job stage, also for the stage column of the processing log. */
export const STAGE_LABEL: Record<ProcessingStage, string> = {
  queued: 'Waiting to start',
  transcode: 'Transcoding',
  upload: 'Storing on Sia',
  finalize: 'Publishing',
  completed: 'Done',
  failed: 'Failed',
};

/** The label for a stage a log line names; an unknown one reads as itself. */
export function stageLabel(stage: string): string {
  return STAGE_LABEL[stage as ProcessingStage] ?? stage;
}

export type JobStep = 'transcode' | 'upload' | 'finalize';

const STEP_OF: Record<JobStep, PipelineStep> = {
  transcode: 'transcode',
  upload: 'store',
  finalize: 'publish',
};

const isStep = (s: string | undefined): s is JobStep =>
  s === 'transcode' || s === 'upload' || s === 'finalize';

/** The stage a job is on, or failed in: a failed job reports stage "failed", its last log line says where. */
export function jobStep(job: ProcessingJob): JobStep | null {
  if (isStep(job.stage)) return job.stage;
  const last = job.logs[job.logs.length - 1]?.stage;
  return isStep(last) ? last : null;
}

/** The message the transcode worker logs when it hands the video to the Sia uploader (B-14). */
export const SIA_WAIT_MESSAGE = 'Waiting for the Sia uploader';

/**
 * Whether the job is waiting in the Sia upload queue: transcoding is done and
 * no uploader has started on it. Servers before B-14 log nothing at the hand
 * off, so for them the wait still reads as transcoding at 65%.
 */
export function isWaitingForSia(job: ProcessingJob): boolean {
  if (job.status !== 'processing' && job.status !== 'queued') return false;
  const last = job.logs[job.logs.length - 1];
  return last?.stage === 'upload' && last.message === SIA_WAIT_MESSAGE;
}

export interface ProcessingView {
  /** "Transcoding", "Storing on Sia", "Waiting to start", "Done", "Transcoding, trying again" */
  label: string;
  /** A second line when there is more to say, such as the Sia wait. */
  detail: string | null;
  tone: StatusTone;
  /** 0 to 100, or null when there is no number to show (not started, failed). */
  percent: number | null;
  /** Where the job is in the pipeline diagram; null before it starts. */
  step: PipelineStep | null;
  /** Work is under way: draw a pulse or a spinner. */
  busy: boolean;
}

/** What to show for a job: label, tone, percent and pipeline step. */
export function processingView(job: Job): ProcessingView {
  const percent = Math.max(0, Math.min(100, Math.round(job.progressPercent)));
  const step = jobStep(job);
  const pipelineStep = step ? STEP_OF[step] : null;

  if (job.status === 'completed' || job.stage === 'completed') {
    return {
      label: STAGE_LABEL.completed,
      detail: null,
      tone: 'success',
      percent: 100,
      step: 'publish',
      busy: false,
    };
  }
  if (job.status === 'failed') {
    return {
      label: STAGE_LABEL.failed,
      detail: null,
      tone: 'danger',
      percent: null,
      step: pipelineStep,
      busy: false,
    };
  }
  if (job.status === 'retrying') {
    const label = step ? STAGE_LABEL[step] : 'Processing';
    return {
      label: `${label}, trying again`,
      detail: null,
      tone: 'progress',
      percent,
      step: pipelineStep,
      busy: true,
    };
  }
  if (isWaitingForSia(job)) {
    return {
      label: STAGE_LABEL.upload,
      detail: SIA_WAIT_MESSAGE,
      tone: 'progress',
      percent,
      step: 'store',
      busy: true,
    };
  }
  if (job.status === 'queued' || !step) {
    return {
      label: STAGE_LABEL.queued,
      detail: null,
      tone: 'neutral',
      percent: null,
      step: null,
      busy: false,
    };
  }
  return {
    label: STAGE_LABEL[step],
    detail: null,
    tone: 'progress',
    percent,
    step: pipelineStep,
    busy: true,
  };
}

/** One line for a job: "Storing on Sia, 65%", "Waiting to start", "Done". */
export function jobSummary(job: Job): string {
  const view = processingView(job);
  if (!view.busy || view.percent === null || job.status === 'retrying') return view.label;
  return `${view.label}, ${view.percent}%`;
}

export interface FailureInfo {
  /** The heading for a failed run. */
  title: string;
  /**
   * What went wrong, in one plain sentence; the action button says what to
   * do. In a toast it follows the video's name: "“Teaser” failed. {body}".
   */
  body: string;
  /** Whether retrying processing can help. */
  retryable: boolean;
  /** The one action to offer: retry, upload a different file, or nothing (the video is not failed). */
  action: 'retry' | 'reupload' | 'none';
  /** The raw error message, for a Details disclosure only; null when the server gave none. */
  detail: string | null;
}

// ffprobe is the first thing to read the file; it fails on anything that is not a video
const UNREADABLE = /ffprobe|invalid data found|no video stream|has no frame size/i;
const SOURCE_GONE = /enoent|no such file|source file not found/i;

/**
 * Why a run failed and what to offer. `retryable` from the server (B-15)
 * decides; without it an unreadable file counts as final, which is what the
 * server will say once B-15 lands. The raw message (often an ffmpeg line
 * with server paths in it) is only in `detail`.
 */
export function failureInfo(job: Job | undefined, asset?: Pick<VideoAsset, 'status'>): FailureInfo {
  const message = job?.errorMessage?.trim() || null;
  const unreadable = message !== null && UNREADABLE.test(message);
  const retryable = typeof job?.retryable === 'boolean' ? job.retryable : !unreadable;
  const action = asset && asset.status !== 'failed' ? 'none' : retryable ? 'retry' : 'reupload';
  return {
    title: 'Processing failed',
    body: failureBody(job, message, unreadable, retryable),
    retryable,
    action,
    detail: message,
  };
}

function failureBody(
  job: Job | undefined,
  message: string | null,
  unreadable: boolean,
  retryable: boolean,
): string {
  if (unreadable) return 'The file is not a readable video.';
  if (message && SOURCE_GONE.test(message)) {
    return 'The original file is no longer on the server.';
  }
  const hint = retryable ? ' Retrying usually works.' : '';
  switch (job ? jobStep(job) : null) {
    case 'transcode':
      return 'Transcoding the video failed.';
    case 'upload':
      return `Storing the video on Sia failed.${hint}`;
    case 'finalize':
      return `Publishing the video failed.${hint}`;
    default:
      return message
        ? `Processing stopped with an error.${hint}`
        : 'Processing failed before it recorded a reason.';
  }
}

/** The plain reason a run failed: failureInfo's body. */
export function failureSummary(job: Job | undefined): string {
  return failureInfo(job).body;
}

// the retry endpoint names where the new run starts; say it with the stage labels
const RESTART_LABEL: Record<RetryStage, string> = {
  transcode: STAGE_LABEL.transcode,
  'upload-segments': STAGE_LABEL.upload,
};

/**
 * The toast after a retry: "Processing restarted from Storing on Sia", or
 * with the title first where several videos show: "“Teaser”: processing
 * restarted from Transcoding".
 */
export function restartedMessage(stage: RetryStage, title?: string): string {
  const from = RESTART_LABEL[stage] ?? STAGE_LABEL.transcode;
  return title
    ? `“${title}”: processing restarted from ${from}`
    : `Processing restarted from ${from}`;
}

/** How long an upload may sit at created or uploading before it counts as interrupted. */
export const INTERRUPTED_AFTER_MS = 10 * 60 * 1000;

/**
 * Whether a video's upload stopped arriving: created or uploading for more
 * than ten minutes and not being sent by this browser right now (FLW-12).
 * Another tab may still be sending it; the card says how to continue either way.
 */
export function isInterrupted(
  asset: Pick<VideoAsset, 'status' | 'createdAt'>,
  sendingHere: boolean,
  now = Date.now(),
): boolean {
  if (asset.status !== 'created' && asset.status !== 'uploading') return false;
  if (sendingHere) return false;
  return now - Date.parse(asset.createdAt) > INTERRUPTED_AFTER_MS;
}
