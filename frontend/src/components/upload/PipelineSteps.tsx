import { Check, Circle, X } from 'lucide-react';
import type { ProcessingJob } from '@sluby/sdk';
import { Spinner } from '@/components/ui/spinner';
import type { UploadState } from '@/lib/upload-store';
import { cn } from '@/lib/utils';

export const PIPELINE_STEPS = [
  { key: 'upload', label: 'Upload', detail: 'Resumable tus transfer to the backend' },
  { key: 'transcode', label: 'Transcode', detail: 'FFmpeg renders the HLS ladder' },
  { key: 'store', label: 'Store on Sia', detail: 'Playlists, media and thumbnails pinned' },
  { key: 'finalize', label: 'Finalize', detail: 'Manifests rewritten, asset goes live' },
] as const;

type StepState = 'done' | 'active' | 'pending' | 'failed';

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

export function stepStates(state: UploadState): StepState[] {
  const states = (current: number, failed = false): StepState[] =>
    PIPELINE_STEPS.map((_, i) =>
      i < current ? 'done' : i === current ? (failed ? 'failed' : 'active') : 'pending',
    );

  switch (state.phase) {
    case 'uploading':
    case 'paused':
      return states(0);
    case 'processing':
      return states(jobStepIndex(state.job));
    case 'ready':
      return states(PIPELINE_STEPS.length);
    case 'failed':
      return state.failedDuring === 'upload'
        ? states(0, true)
        : states(jobStepIndex(state.job), true);
    default:
      return states(-1);
  }
}

export function PipelineSteps({ state }: { state: UploadState }) {
  const steps = stepStates(state);
  const queued = state.phase === 'processing' && (!state.job || state.job.stage === 'queued');

  return (
    <ol className="flex flex-col gap-4">
      {PIPELINE_STEPS.map((step, i) => {
        const s = steps[i];
        return (
          <li key={step.key} className="flex items-start gap-3" data-state={s}>
            <span
              className={cn(
                'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border',
                s === 'done' && 'border-success bg-success/10 text-success',
                s === 'active' && 'border-primary text-primary',
                s === 'failed' && 'border-destructive bg-destructive/10 text-destructive',
                s === 'pending' && 'text-muted-foreground',
              )}
            >
              {s === 'done' ? (
                <Check className="size-3.5" />
              ) : s === 'failed' ? (
                <X className="size-3.5" />
              ) : s === 'active' ? (
                <Spinner className="size-3.5" aria-hidden="true" />
              ) : (
                <Circle className="size-2 fill-current" />
              )}
            </span>
            <div className="min-w-0">
              <p
                className={cn(
                  'text-sm font-medium',
                  s === 'pending' && 'text-muted-foreground',
                  s === 'failed' && 'text-destructive',
                )}
              >
                {step.label}
                {s === 'active' && i === 1 && queued && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">queued</span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">{step.detail}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
