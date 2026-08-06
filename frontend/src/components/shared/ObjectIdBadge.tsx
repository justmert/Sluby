import { CopyButton } from './CopyButton';
import { cn } from '@/lib/cn';

export interface ObjectIdBadgeProps {
  /** The Sia object id (hex string). */
  value: string;
  /** Chars to show on each side of the ellipsis (default 8). */
  truncate?: number;
  /** Optional class for the outer wrapper. */
  className?: string;
  /** Hide the copy control if you just want the truncated label (default: false). */
  hideCopy?: boolean;
}

function truncateMiddle(value: string, chars: number): string {
  if (value.length <= chars * 2 + 3) return value;
  return `${value.slice(0, chars)}\u2026${value.slice(-chars)}`;
}

/**
 * Renders a Sia object id as truncated monospace hex with an optional
 * copy control. Object ids are app-layer hashes (not on-chain entities) so
 * they intentionally do not link to the blockchain explorer — see
 * `lib/sia-explorer.ts` for why.
 */
export function ObjectIdBadge({
  value,
  truncate = 8,
  className,
  hideCopy = false,
}: ObjectIdBadgeProps) {
  return (
    <span className={cn('inline-flex items-center gap-1', className)} title={value}>
      <span className="font-mono text-zinc-300 truncate">{truncateMiddle(value, truncate)}</span>
      {!hideCopy && <CopyButton value={value} className="h-6 w-6 min-w-[24px] min-h-[24px]" />}
    </span>
  );
}
