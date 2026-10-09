import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { Circle, Minus, Pause, X } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import type { UploadState } from '@/lib/upload-store';
import { duration, easeOut, scaleIn } from '@/lib/motion';
import { PIPELINE_STEPS as STEP_NAMES } from '@/components/asset/processing';
import { stepStates, type StepState } from './pipeline-steps';

// the D-30 step names from processing.ts, each with one line on what happens (CPY-05)
const PIPELINE_STEPS = [
  { ...STEP_NAMES[0], detail: 'The file is sent to this server and resumes if interrupted' },
  { ...STEP_NAMES[1], detail: 'Converted into several qualities for streaming' },
  { ...STEP_NAMES[2], detail: 'Video, playlists and thumbnails are stored on Sia' },
  { ...STEP_NAMES[3], detail: 'The video becomes playable' },
] as const;
import { cn } from '@/lib/utils';

/** A check that draws itself in when a step completes. */
function DrawnCheck() {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" fill="none" aria-hidden="true">
      <m.path
        d="M20 6 9 17l-5-5"
        stroke="currentColor"
        strokeWidth={2.5}
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
      return <X className="size-3.5" aria-hidden="true" />;
    case 'active':
      return <Spinner className="size-3.5" role={undefined} aria-hidden="true" />;
    case 'paused':
      return <Pause className="size-3" aria-hidden="true" />;
    case 'cancelled':
      return <X className="size-3" aria-hidden="true" />;
    case 'skipped':
      return <Minus className="size-3" aria-hidden="true" />;
    default:
      return <Circle className="size-2 fill-current" aria-hidden="true" />;
  }
}

export function PipelineSteps({
  state,
  compact = false,
}: {
  state: Pick<UploadState, 'phase' | 'job' | 'failedDuring'>;
  /** Leave out the one-line explanation under each step. */
  compact?: boolean;
}) {
  const steps = stepStates(state);

  return (
    <ol className={cn('flex flex-col', compact ? 'gap-3' : 'gap-4')}>
      {PIPELINE_STEPS.map((step, i) => {
        const s = steps[i];
        return (
          <li key={step.key} className="relative flex items-start gap-3" data-state={s}>
            {/* the rail between steps fills in as the work moves past it */}
            {i < PIPELINE_STEPS.length - 1 && (
              <span
                aria-hidden="true"
                className="absolute top-7 bottom-[-0.75rem] left-[11px] w-px overflow-hidden bg-border"
              >
                <span
                  className={cn(
                    'block h-full w-full origin-top bg-success transition-transform duration-300 ease-out-soft',
                    s === 'done' ? 'scale-y-100' : 'scale-y-0',
                  )}
                />
              </span>
            )}
            <span
              className={cn(
                'relative mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border bg-card transition-colors duration-200',
                s === 'done' && 'border-success bg-success/10 text-success',
                s === 'active' && 'border-primary text-primary',
                s === 'paused' && 'border-muted-foreground text-muted-foreground',
                s === 'failed' && 'border-destructive bg-destructive/10 text-destructive',
                s === 'cancelled' && 'border-muted-foreground/60 text-muted-foreground',
                (s === 'pending' || s === 'skipped') && 'text-muted-foreground',
                s === 'skipped' && 'border-dashed',
              )}
            >
              <AnimatePresence initial={false} mode="popLayout">
                <m.span
                  key={s}
                  variants={scaleIn}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="col-start-1 row-start-1 flex"
                >
                  <StepIcon state={s} />
                </m.span>
              </AnimatePresence>
            </span>
            <div className="min-w-0">
              <p
                className={cn(
                  'text-sm font-medium transition-colors duration-200',
                  (s === 'pending' || s === 'skipped' || s === 'cancelled') &&
                    'text-muted-foreground',
                  s === 'skipped' && 'font-normal',
                  s === 'failed' && 'text-destructive',
                )}
              >
                {step.label}
              </p>
              {!compact && <p className="text-xs text-muted-foreground">{step.detail}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
