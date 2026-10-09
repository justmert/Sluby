import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { Circle, Minus, Pause, X } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { duration, easeOut, scaleIn } from '@/lib/motion';
import { cn } from '@/lib/utils';
import type { StepState } from './pipeline-states';
import { PIPELINE_STEPS } from './processing';

/** A check that draws itself in when a step completes. */
function DrawnCheck() {
  return (
    <svg viewBox="0 0 24 24" className="size-3" fill="none" aria-hidden="true">
      <m.path
        d="M20 6 9 17l-5-5"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: duration.slow, ease: easeOut, delay: 0.05 }}
      />
    </svg>
  );
}

function StepIcon({ state }: { state: StepState }) {
  switch (state) {
    case 'done':
      return <DrawnCheck />;
    case 'failed':
      return <X className="size-3" strokeWidth={3} aria-hidden="true" />;
    case 'active':
      return (
        <Spinner className="size-3" role={undefined} aria-label={undefined} aria-hidden="true" />
      );
    case 'paused':
    case 'stopped':
      return <Pause className="size-2.5" aria-hidden="true" />;
    case 'cancelled':
      return <X className="size-2.5" aria-hidden="true" />;
    case 'skipped':
      return <Minus className="size-2.5" aria-hidden="true" />;
    default:
      return <Circle className="size-1.5 fill-current" aria-hidden="true" />;
  }
}

// what a screen reader hears after the step name; the ring alone is color and shape
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

// filled rings for done and failed: an outlined check or x at 20 px reads as an empty radio (VIS-25)
const RING: Record<StepState, string> = {
  done: 'border-success bg-success text-background',
  failed: 'border-destructive-solid bg-destructive-solid text-destructive-solid-foreground',
  active: 'border-primary bg-card text-primary',
  waiting: 'border-primary bg-card text-primary',
  paused: 'border-muted-foreground bg-card text-muted-foreground',
  stopped: 'border-muted-foreground bg-card text-muted-foreground',
  cancelled: 'border-muted-foreground/60 bg-card text-muted-foreground',
  skipped: 'border-dashed bg-card text-muted-foreground',
  pending: 'bg-card text-muted-foreground',
};

const quiet = (s: StepState) => s === 'pending' || s === 'skipped' || s === 'cancelled';

function Ring({ state }: { state: StepState }) {
  return (
    <span
      className={cn(
        'relative grid size-5 shrink-0 place-items-center rounded-full border transition-colors duration-200',
        RING[state],
      )}
    >
      <AnimatePresence initial={false} mode="popLayout">
        <m.span
          key={state}
          variants={scaleIn}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="col-start-1 row-start-1 flex"
        >
          <StepIcon state={state} />
        </m.span>
      </AnimatePresence>
    </span>
  );
}

/** The line from one step to the next; it fills in as the work moves past. */
function Rail({ filled, vertical }: { filled: boolean; vertical: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-slot="pipeline-rail"
      className={cn(
        'overflow-hidden bg-border',
        vertical ? 'absolute top-6 bottom-[-0.5rem] left-[9.5px] w-px' : 'mx-2 h-px min-w-3 flex-1',
      )}
    >
      <span
        className={cn(
          'block size-full bg-success transition-transform duration-300 ease-out-soft',
          vertical ? 'origin-top' : 'origin-left',
          filled
            ? vertical
              ? 'scale-y-100'
              : 'scale-x-100'
            : vertical
              ? 'scale-y-0'
              : 'scale-x-0',
        )}
      />
    </span>
  );
}

export interface PipelineStepsProps {
  /** One state per step in PIPELINE_STEPS order: assetSteps(...) or uploadSteps(...). */
  steps: StepState[];
  /** Horizontal on the video page's processing card, vertical in upload rows. */
  orientation?: 'horizontal' | 'vertical';
  /** sm: 12 px labels, for rows and sheets. md: 14 px labels. Rings are 20 px in both. */
  size?: 'sm' | 'md';
  /** Show the one-line explanation under each step (vertical only). */
  details?: boolean;
  className?: string;
}

/**
 * The four processing steps (Upload, Transcode, Store on Sia, Publish) with
 * where each one stands. One component for the video page, the upload sheet
 * and anywhere else the steps show (VIS-25).
 *
 *   // assetSteps and uploadSteps come from ./pipeline-states
 *   <PipelineSteps steps={assetSteps(asset, job.data)} />
 *   <PipelineSteps steps={uploadSteps(upload)} orientation="vertical" size="sm" />
 */
export function PipelineSteps({
  steps,
  orientation = 'horizontal',
  size = 'md',
  details = false,
  className,
}: PipelineStepsProps) {
  const vertical = orientation === 'vertical';
  const last = PIPELINE_STEPS.length - 1;
  return (
    <ol
      aria-label="Processing steps"
      data-orientation={orientation}
      className={cn(
        vertical ? 'flex flex-col' : 'grid grid-cols-4 gap-y-2',
        vertical && (size === 'sm' ? 'gap-3' : 'gap-4'),
        className,
      )}
    >
      {PIPELINE_STEPS.map((step, i) => {
        const state = steps[i] ?? 'pending';
        const label = (
          <span
            className={cn(
              'font-medium transition-colors duration-200',
              size === 'sm' ? 'text-xs' : 'text-sm',
              quiet(state) && 'text-muted-foreground',
              state === 'skipped' && 'font-normal',
              state === 'failed' && 'text-destructive',
            )}
          >
            {step.label}
            <span className="sr-only">, {SPOKEN[state]}</span>
          </span>
        );
        return (
          <li
            key={step.key}
            data-state={state}
            aria-current={state === 'active' ? 'step' : undefined}
            className={cn(
              'relative min-w-0',
              vertical ? 'flex items-start gap-3' : 'flex flex-col gap-2',
            )}
          >
            {vertical ? (
              <>
                {i < last && <Rail filled={state === 'done'} vertical />}
                <Ring state={state} />
                <div className="min-w-0 pt-px">
                  <p className="leading-5">{label}</p>
                  {details && <p className="text-xs text-muted-foreground">{step.detail}</p>}
                </div>
              </>
            ) : (
              <>
                <span className="flex items-center">
                  <Ring state={state} />
                  {i < last && <Rail filled={state === 'done'} vertical={false} />}
                </span>
                {/* a label wider than its quarter (Transcode at 320) breaks inside it */}
                <span className="pr-2 leading-tight hyphens-auto wrap-break-word">{label}</span>
              </>
            )}
          </li>
        );
      })}
    </ol>
  );
}
