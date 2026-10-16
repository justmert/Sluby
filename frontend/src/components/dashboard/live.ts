import { useEffect } from 'react';
import { lateReveal } from '@/lib/motion';

/** see lateReveal in lib/motion.ts; kept under this name for the dashboard parts */
export const lateSkeleton = lateReveal;

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
