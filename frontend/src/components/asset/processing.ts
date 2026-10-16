import type { ProcessingJob } from '@sluby/sdk';

export type JobStep = 'transcode' | 'upload' | 'finalize';

const STEP_LABEL: Record<JobStep, string> = {
  transcode: 'Transcoding',
  upload: 'Storing on Sia',
  finalize: 'Finalizing',
};

const isStep = (s: string | undefined): s is JobStep =>
  s === 'transcode' || s === 'upload' || s === 'finalize';

/** The step a job is on, or failed in: a failed job reports stage "failed", its last log line says where. */
export function jobStep(job: ProcessingJob): JobStep | null {
  if (isStep(job.stage)) return job.stage;
  const last = job.logs[job.logs.length - 1]?.stage;
  return isStep(last) ? last : null;
}

/** "Storing on Sia, 65%", or what the job is waiting for. */
export function jobSummary(job: ProcessingJob): string {
  if (job.stage === 'completed') return 'Done';
  if (job.status === 'queued' || job.stage === 'queued') return 'Waiting in the queue';
  const step = jobStep(job);
  const label = step ? STEP_LABEL[step] : 'Processing';
  const percent = `${Math.round(job.progressPercent)}%`;
  return job.status === 'retrying' ? `${label}, retrying` : `${label}, ${percent}`;
}

/**
 * A plain reading of why a run failed. The raw message (often an ffmpeg or
 * ffprobe line with server paths in it) stays available under Details.
 */
export function failureSummary(job: ProcessingJob | undefined): string {
  const message = job?.errorMessage ?? '';
  // ffprobe is the first thing to read the file; it fails on anything that is not a video
  if (/ffprobe|no video stream|has no frame size/i.test(message)) {
    return 'The file is not a readable video.';
  }
  switch (job ? jobStep(job) : null) {
    case 'transcode':
      return 'Transcoding the video failed.';
    case 'upload':
      return 'Storing the video on Sia failed. Retrying usually works.';
    case 'finalize':
      return 'Finalizing the video failed. Retrying usually works.';
    default:
      return 'Processing stopped with an error.';
  }
}
