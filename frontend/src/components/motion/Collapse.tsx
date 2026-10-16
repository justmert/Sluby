import type { ReactNode } from 'react';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { collapse } from '@/lib/motion';

interface CollapseProps {
  open: boolean;
  children: ReactNode;
  /** goes on the inner element, so padding does not fight the height animation */
  className?: string;
  /** for the trigger's aria-controls */
  id?: string;
}

/**
 * Animates height from 0 to auto and back, and unmounts the content once
 * closed. Under reduced motion the height changes at once and only the fade
 * remains. The first render does not animate.
 */
export function Collapse({ open, children, className, id }: CollapseProps) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <m.div
          key="collapse"
          id={id}
          variants={collapse}
          initial="hidden"
          animate="visible"
          exit="exit"
          className="overflow-hidden"
        >
          <div className={className}>{children}</div>
        </m.div>
      )}
    </AnimatePresence>
  );
}
