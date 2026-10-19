import { cn } from '@/lib/utils';
import { stepFill, type StepState } from './pipeline-states';
import { PIPELINE_STEPS } from './processing';

// what a screen reader hears after the step name; the fill alone is shape and color
const SPOKEN: Record<StepState, string> = {
  done: 'done',
  active: 'in progress',
  waiting: 'waiting to start',
  paused: 'paused',
  stopped: 'stopped',
  pending: 'not started',
  failed: 'failed',
  cancelled: 'canceled',
  skipped: 'will not run',
};

const FILL: Record<StepState, string> = {
  done: 'bg-progress',
  active: 'bg-progress',
  waiting: 'bg-progress',
  paused: 'bg-muted-foreground/50',
  stopped: 'bg-muted-foreground/50',
  failed: 'bg-destructive-solid',
  cancelled: 'bg-transparent',
  skipped: 'bg-transparent',
  pending: 'bg-transparent',
};

export interface PipelineProgressProps {
  /** One state per step in PIPELINE_STEPS order: assetSteps(...) or uploadSteps(...). */
  steps: StepState[];
  /** The upload's own percent while the file is sent. */
  upload?: number | null;
  /** The processing job's overall percent, split over the server steps. */
  percent?: number | null;
  /** The work is running now: a soft light crosses the filling part. */
  moving?: boolean;
  /** sm for upload rows, md for the video page's processing card. */
  size?: 'sm' | 'md';
  /** The progressbar's name, such as "<title>, processing progress". */
  label: string;
  className?: string;
}

/**
 * One bar in four parts, Upload, Transcode, Store on Sia and Publish, each
 * filling with its own step, the step names under it. It replaces a separate
 * bar and stepper that told the same story twice.
 */
export function PipelineProgress({
  steps,
  upload,
  percent,
  moving = false,
  size = 'md',
  label,
  className,
}: PipelineProgressProps) {
  const states = PIPELINE_STEPS.map((_, i) => steps[i] ?? 'pending');
  const fills = states.map((s, i) => stepFill(i, s, { upload, percent }));
  // the overall value a screen reader hears: done steps plus the part of the current one
  const overall = Math.round((fills.reduce((a, b) => a + b, 0) / fills.length) * 100);
  const current = states.findIndex((s) => s !== 'done');
  // running with no number yet (the file is sent, the job has not reported):
  // a light runs along the empty part instead of a fill that sits at 0
  const unknown = (i: number) =>
    states[i] === 'waiting' ||
    (states[i] === 'active' && (i === 0 ? upload == null : percent == null));

  return (
    <div className={cn('flex flex-col', size === 'sm' ? 'gap-1.5' : 'gap-2.5', className)}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={overall}
        className={cn('grid grid-cols-4', size === 'sm' ? 'gap-1' : 'gap-1.5')}
      >
        {states.map((state, i) => (
          <span
            key={PIPELINE_STEPS[i].key}
            data-slot="pipeline-segment"
            data-state={state}
            className={cn(
              'relative overflow-hidden rounded-full bg-sunken',
              size === 'sm' ? 'h-1.5' : 'h-2',
              state === 'skipped' && 'bg-transparent outline outline-dashed outline-border',
            )}
          >
            {unknown(i) ? (
              <span className="absolute inset-y-0 w-1/3 -translate-x-full rounded-full bg-progress/50 motion-safe:animate-shimmer motion-reduce:w-full motion-reduce:translate-x-0 motion-reduce:bg-progress/25" />
            ) : (
              <span
                data-slot="pipeline-fill"
                data-moving={(moving && state === 'active') || undefined}
                className={cn(
                  // width, not a scale: a scaled rounded end squashes into an oval
                  'absolute inset-y-0 left-0 rounded-full transition-[width] duration-(--duration-progress) ease-design',
                  FILL[state],
                  moving &&
                    state === 'active' &&
                    'overflow-hidden after:absolute after:inset-0 after:-translate-x-full after:bg-linear-to-r after:from-transparent after:via-white/40 after:to-transparent motion-safe:after:animate-sheen motion-reduce:after:hidden',
                )}
                style={{ width: `${fills[i] * 100}%` }}
              />
            )}
          </span>
        ))}
      </div>
      <ol
        aria-label="Processing steps"
        className={cn('grid grid-cols-4', size === 'sm' ? 'gap-1' : 'gap-1.5')}
      >
        {states.map((state, i) => (
          <li
            key={PIPELINE_STEPS[i].key}
            data-state={state}
            aria-current={i === current && state === 'active' ? 'step' : undefined}
            className={cn(
              // a name wider than its quarter wraps inside it rather than losing its end
              'min-w-0 leading-tight hyphens-auto wrap-break-word transition-colors duration-200',
              size === 'sm' ? 'text-xs' : 'text-sm max-sm:text-xs',
              state === 'done' && 'text-muted-foreground',
              (state === 'active' || state === 'waiting') && 'font-medium text-foreground',
              (state === 'paused' || state === 'stopped') && 'font-medium text-muted-foreground',
              state === 'failed' && 'font-medium text-destructive',
              (state === 'pending' || state === 'skipped' || state === 'cancelled') &&
                'text-muted-foreground/70',
            )}
          >
            {PIPELINE_STEPS[i].label}
            <span className="sr-only">, {SPOKEN[state]}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
