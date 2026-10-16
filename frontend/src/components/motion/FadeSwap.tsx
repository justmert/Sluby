import type { ReactNode } from 'react';
import { AnimatePresence, useIsPresent } from 'motion/react';
import * as m from 'motion/react-m';
import { fade } from '@/lib/motion';
import { cn } from '@/lib/utils';

interface FadeSwapProps {
  /** change this to swap, e.g. `isPending ? 'loading' : 'ready'` */
  swapKey: string;
  children: ReactNode;
  className?: string;
}

/**
 * Crossfades between states. Old and new content sit in the same grid cell
 * while they fade, so nothing below jumps when the swap starts; the leaving
 * copy is inert and hidden from screen readers. The first render does not
 * animate.
 */
export function FadeSwap({ swapKey, children, className }: FadeSwapProps) {
  return (
    <div className={cn('grid', className)}>
      <AnimatePresence initial={false}>
        <Layer key={swapKey}>{children}</Layer>
      </AnimatePresence>
    </div>
  );
}

function Layer({ children }: { children: ReactNode }) {
  const present = useIsPresent();
  return (
    <m.div
      variants={fade}
      initial="hidden"
      animate="visible"
      exit="exit"
      inert={!present}
      aria-hidden={present ? undefined : true}
      className="col-start-1 row-start-1 min-w-0"
    >
      {children}
    </m.div>
  );
}
