import type { ReactNode } from 'react';
import { useLocation } from 'react-router';
import * as m from 'motion/react-m';
import { pageTransition } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * Fades and lifts the routed page in when the pathname changes. Enter only:
 * there is no exit, so the old page is never kept alive next to the new one
 * and no page mounts (or fetches) twice. Search and hash changes keep the
 * page mounted, so filters in the url do not replay the transition.
 */
export function PageTransition({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { pathname } = useLocation();
  return (
    <m.div
      key={pathname}
      variants={pageTransition}
      initial="hidden"
      animate="visible"
      className={cn('flex min-h-full flex-col', className)}
    >
      {children}
    </m.div>
  );
}
