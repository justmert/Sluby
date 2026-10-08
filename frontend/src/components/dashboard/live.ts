/** "just now", "12 s ago", "3 min ago", "2 h ago" */
export function agoText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}

/** For a skeleton: it stays invisible for the first 150 ms, so a quick answer never flashes one. */
export const lateSkeleton = 'animate-in fade-in-0 fill-mode-backwards delay-150 duration-200';
