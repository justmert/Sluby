import { Check, Circle, Pause, X } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import type { UploadState } from '@/lib/upload-store';
import { PIPELINE_STEPS, stepStates } from './pipeline-steps';
import { cn } from '@/lib/utils';

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
                s === 'paused' && 'border-muted-foreground text-muted-foreground',
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
              ) : s === 'paused' ? (
                <Pause className="size-3" aria-hidden="true" />
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
                {s === 'paused' && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">paused</span>
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
