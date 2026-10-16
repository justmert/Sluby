import type { ProcessingJob, VideoAsset } from '@sluby/sdk';
import type { UploadState } from '@/lib/upload-store';
import { isWaitingForSia, jobStep, PIPELINE_STEPS, type JobStep } from './processing';

/*
 * where each of the four processing steps stands, for PipelineSteps. the
 * video page reads it from the server (asset status plus processing job),
 * the upload sheet from its own store; both draw the same component.
 */

export type StepState =
  | 'done'
  | 'active'
  /** next up, but nothing has started on it yet (a queued job) */
  | 'waiting'
  /** the person paused the transfer */
  | 'paused'
  /** the transfer stopped on its own, for example because the tab closed */
  | 'stopped'
  | 'pending'
  | 'failed'
  | 'cancelled'
  /** will not run, because an earlier step was cancelled */
  | 'skipped';

// upload is step 0; the job's stages are the three after it
const INDEX: Record<JobStep, number> = { transcode: 1, upload: 2, finalize: 3 };

/** Steps before `at` done, `at` in `state`, the rest pending. */
function upTo(at: number, state: StepState): StepState[] {
  return PIPELINE_STEPS.map((_, i) => (i < at ? 'done' : i === at ? state : 'pending'));
}

const allDone = (): StepState[] => PIPELINE_STEPS.map(() => 'done');
const uploadOnly = (): StepState[] => PIPELINE_STEPS.map((_, i) => (i === 0 ? 'done' : 'pending'));

/**
 * Steps for a job whose bytes have arrived. Without a job (not loaded, or the
 * status call failed) only the upload is known to be done, so no later step
 * is drawn as running or failed on a guess (FLW-11).
 */
function serverSteps(job: ProcessingJob | undefined | null, failed: boolean): StepState[] {
  if (!job) return uploadOnly();
  if (job.stage === 'completed' || job.status === 'completed') return allDone();
  const step = jobStep(job);
  // a failed job that never logged a stage: say nothing about where
  if (failed) return step ? upTo(INDEX[step], 'failed') : uploadOnly();
  if (isWaitingForSia(job)) return upTo(INDEX.upload, 'active');
  if (job.status === 'queued' || !step) return upTo(INDEX.transcode, 'waiting');
  return upTo(INDEX[step], 'active');
}

/**
 * Steps for a video as the server reports it. `job` is the processing job
 * when one is known; `interrupted` marks an upload that stopped arriving
 * (created or uploading for more than ten minutes, FLW-12).
 */
export function assetSteps(
  asset: Pick<VideoAsset, 'status'>,
  job?: ProcessingJob | null,
  { interrupted = false }: { interrupted?: boolean } = {},
): StepState[] {
  switch (asset.status) {
    case 'ready':
      return allDone();
    case 'created':
    case 'uploading':
      // the file has not all arrived, so the upload is the step under way
      return upTo(0, interrupted ? 'stopped' : 'active');
    case 'processing':
    case 'failed': {
      // the job is the fresher signal: it moves first when a retry starts
      const failed = job ? job.status === 'failed' : asset.status === 'failed';
      return serverSteps(job, failed);
    }
  }
}

/** Steps for an upload in this browser's upload store. */
export function uploadSteps(
  state: Pick<UploadState, 'phase' | 'job' | 'failedDuring'>,
): StepState[] {
  switch (state.phase) {
    case 'uploading':
    case 'finishing':
      return upTo(0, 'active');
    case 'paused':
      return upTo(0, 'paused');
    case 'processing':
      return serverSteps(state.job, false);
    case 'ready':
      return allDone();
    case 'failed':
      return state.failedDuring === 'upload' ? upTo(0, 'failed') : serverSteps(state.job, true);
    case 'cancelled':
      // nothing after a cancelled transfer is going to run
      return PIPELINE_STEPS.map((_, i) => (i === 0 ? 'cancelled' : 'skipped'));
  }
}
