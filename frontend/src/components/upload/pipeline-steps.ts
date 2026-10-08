import type { ProcessingJob } from '@sluby/sdk';
import type { UploadState } from '@/lib/upload-store';

export const PIPELINE_STEPS = [
  { key: 'upload', label: 'Upload', detail: 'Resumable tus transfer to the backend' },
  { key: 'transcode', label: 'Transcode', detail: 'FFmpeg renders the HLS ladder' },
  { key: 'store', label: 'Store on Sia', detail: 'Playlists, media and thumbnails pinned' },
  { key: 'finalize', label: 'Finalize', detail: 'Manifests rewritten, asset goes live' },
] as const;

export type StepState =
  'done' | 'active' | 'paused' | 'pending' | 'failed' | 'cancelled' | 'skipped';

const STAGE_INDEX: Record<string, number> = { transcode: 1, upload: 2, finalize: 3 };

/** Index of the pipeline step a processing job is on (or failed in). */
function jobStepIndex(job: ProcessingJob | null): number {
  if (!job) return 1;
  if (job.stage === 'completed') return PIPELINE_STEPS.length;
  if (job.stage in STAGE_INDEX) return STAGE_INDEX[job.stage];
  // a failed job reports stage "failed"; its last log line says where
  const last = job.logs[job.logs.length - 1]?.stage;
  return last && last in STAGE_INDEX ? STAGE_INDEX[last] : 1;
}

export function stepStates(
  state: Pick<UploadState, 'phase' | 'job' | 'failedDuring'>,
): StepState[] {
  const states = (current: number, failed = false): StepState[] =>
    PIPELINE_STEPS.map((_, i) =>
      i < current ? 'done' : i === current ? (failed ? 'failed' : 'active') : 'pending',
    );

  switch (state.phase) {
    case 'uploading':
    case 'finishing':
      return states(0);
    case 'paused':
      return states(0).map((s) => (s === 'active' ? 'paused' : s));
    case 'processing':
      return states(jobStepIndex(state.job));
    case 'ready':
      return states(PIPELINE_STEPS.length);
    case 'failed':
      return state.failedDuring === 'upload'
        ? states(0, true)
        : states(jobStepIndex(state.job), true);
    case 'cancelled':
      // nothing after a cancelled transfer is going to run
      return PIPELINE_STEPS.map((_, i) => (i === 0 ? 'cancelled' : 'skipped'));
  }
}
