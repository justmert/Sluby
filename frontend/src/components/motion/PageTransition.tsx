import type { ReactNode } from 'react';
import { useLocation } from 'react-router';
import { cn } from '@/lib/utils';

/**
 * Fades and lifts the routed page in when the pathname changes. It wraps the
 * route's suspense boundary too, so its one fade covers whichever shows first,
 * the page or its skeleton; the skeleton then swaps to the page with no
 * second fade (they share a shape). Enter only:
 * there is no exit, so the old page is never kept alive next to the new one
 * and no page mounts (or fetches) twice. Search and hash changes keep the
 * page mounted, so filters in the url do not replay the transition.
 *
 * This one is a css animation rather than a motion component: it sits in the
 * main chunk, and motion's runtime there would cost about 12 kB gzip on every
 * load. Under reduced motion the global css rule cuts it to a single frame.
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
    <div
      key={pathname}
      data-slot="page-transition"
      className={cn(
        'flex min-h-full flex-col animate-in transition-none duration-200 ease-out-soft fade-in-0 slide-in-from-bottom-1',
        className,
      )}
    >
      {children}
    </div>
  );
}
