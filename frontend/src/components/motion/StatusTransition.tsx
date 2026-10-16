import type { ReactNode } from 'react';
import { AnimatePresence, useIsPresent } from 'motion/react';
import * as m from 'motion/react-m';
import { scaleIn } from '@/lib/motion';
import { cn } from '@/lib/utils';

interface StatusTransitionProps {
  /** the status the badge shows; a change swaps the badge */
  status: string;
  /** a soft pulse for in-progress states; off under reduced motion */
  pulse?: boolean;
  /** announce changes politely; use for one status on a page, not every row of a list */
  live?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * Swaps a status badge with a quick fade and scale when `status` changes.
 * Both badges share one grid cell during the swap, so text beside it does
 * not shift until the new width settles.
 */
export function StatusTransition({
  status,
  pulse = false,
  live = false,
  children,
  className,
}: StatusTransitionProps) {
  return (
    <span
      className={cn('inline-grid justify-items-start align-middle', className)}
      aria-live={live ? 'polite' : undefined}
      aria-atomic={live ? true : undefined}
    >
      <AnimatePresence initial={false}>
        <Layer key={status} pulse={pulse}>
          {children}
        </Layer>
      </AnimatePresence>
    </span>
  );
}

function Layer({ pulse, children }: { pulse: boolean; children: ReactNode }) {
  const present = useIsPresent();
  return (
    <m.span
      variants={scaleIn}
      initial="hidden"
      animate="visible"
      exit="exit"
      aria-hidden={present ? undefined : true}
      data-pulse={pulse || undefined}
      className={cn(
        'col-start-1 row-start-1 inline-flex',
        pulse && 'motion-safe:animate-status-pulse',
      )}
    >
      {children}
    </m.span>
  );
}
