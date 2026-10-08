import { useEffect } from 'react';
import { lateReveal } from '@/lib/motion';

/** "just now", "12 s ago", "3 min ago", "2 h ago" */
export function agoText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}

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
