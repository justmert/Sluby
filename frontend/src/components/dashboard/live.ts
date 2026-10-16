import { useEffect } from 'react';

/** "just now", "12 s ago", "3 min ago", "2 h ago" */
export function agoText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}

/**
 * For a skeleton: it stays invisible for the first 150 ms, so a quick answer
 * never flashes one. Below a `data-instant-skeletons` element it shows at
 * once, for a page taking over from a route skeleton that was already on screen.
 */
export const lateSkeleton =
  'animate-in fade-in-0 fill-mode-backwards delay-150 duration-200 in-data-instant-skeletons:animate-none';

// whether a dashboard or analytics route skeleton is on screen right now; its
// 150 ms wait has passed, so the page that replaces it should not hide its own
// skeletons for another 150 ms and blink
let routeSkeletonVisible = false;

/** Call in a route skeleton that hands over to a page drawing the same placeholders. */
export function useRouteSkeletonVisibility() {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      routeSkeletonVisible = true;
    }, 150);
    return () => {
      window.clearTimeout(timer);
      routeSkeletonVisible = false;
    };
  }, []);
}

/** For a page's first render: true when it replaces a route skeleton people already see. */
export const routeSkeletonWasVisible = () => routeSkeletonVisible;
