import { Suspense, type ReactNode } from 'react';
import { useLocation } from 'react-router';
import { RouteFallback } from './RouteFallback';

/**
 * The boundary around the routed page. It is keyed by path: the router
 * navigates in a transition, and react keeps an already shown boundary on
 * the old page until the new chunk arrives, so a click on a page that is
 * still loading would look like it did nothing. A new boundary shows that
 * page's skeleton instead (after its short delay).
 */
export function RouteSuspense({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <Suspense key={pathname} fallback={<RouteFallback />}>
      {children}
    </Suspense>
  );
}
