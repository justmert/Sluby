import { Check, Circle, X } from 'lucide-react';
import type { ProcessingJob } from '@sluby/sdk';
import { PIPELINE_STEPS } from '@/components/upload/pipeline-steps';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { jobStep, type JobStep } from './processing';

type StepState = 'done' | 'active' | 'pending' | 'failed';

// the asset page sees the pipeline from the server side, so the upload is
// always behind it; the pipeline steps map onto the job's stages
const STEP_OF_KEY: Record<string, JobStep | 'upload-file'> = {
  upload: 'upload-file',
  transcode: 'transcode',
  store: 'upload',
  finalize: 'finalize',
};
const ORDER: Array<JobStep | 'upload-file'> = ['upload-file', 'transcode', 'upload', 'finalize'];

function states(job: ProcessingJob | undefined, failed: boolean): StepState[] {
  if (job?.stage === 'completed') return ORDER.map(() => 'done');
  const at = job ? jobStep(job) : null;
  // queued, or no job yet: the upload is done and the transcode is next
  const current = ORDER.indexOf(at ?? 'transcode');
  return ORDER.map((_, i) =>
    i < current ? 'done' : i === current ? (failed ? 'failed' : 'active') : 'pending',
  );
}

/** The pipeline as a compact step list for one asset's processing job. */
export function ProcessingSteps({
  job,
  failed,
}: {
  job: ProcessingJob | undefined;
  failed: boolean;
}) {
  const s = states(job, failed);
  return (
    <ol className="grid gap-2 sm:grid-cols-4" aria-label="Pipeline">
      {PIPELINE_STEPS.map((step) => {
        const state = s[ORDER.indexOf(STEP_OF_KEY[step.key])];
        return (
          <li
            key={step.key}
            data-state={state}
            className="flex items-center gap-2 text-sm"
            aria-current={state === 'active' ? 'step' : undefined}
          >
            <span
              className={cn(
                'flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-200',
                state === 'done' && 'border-success bg-success/10 text-success',
                state === 'active' && 'border-primary text-primary',
                state === 'failed' && 'border-destructive bg-destructive/10 text-destructive',
                state === 'pending' && 'text-muted-foreground',
              )}
            >
              {state === 'done' ? (
                <Check className="size-3 animate-in duration-200 zoom-in-75 fade-in" />
              ) : state === 'failed' ? (
                <X className="size-3" />
              ) : state === 'active' ? (
                <Spinner className="size-3" aria-hidden="true" />
              ) : (
                <Circle className="size-1.5 fill-current" />
              )}
            </span>
            <span
              className={cn(
                'font-medium',
                state === 'pending' && 'text-muted-foreground',
                state === 'failed' && 'text-destructive',
              )}
            >
              {step.label}
              <span className="sr-only">
                {state === 'done'
                  ? ', done'
                  : state === 'active'
                    ? ', in progress'
                    : state === 'failed'
                      ? ', failed'
                      : ', pending'}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
