import { CopyButton } from './CopyButton';
import { truncateMiddle } from '@/lib/formatters';
import { cn } from '@/lib/utils';

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

/**
 * Renders a Sia object id as truncated monospace hex with an optional
 * copy control. Object ids are app-layer hashes (not on-chain entities) so
 * they intentionally do not link to the blockchain explorer, see
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
      <span className="truncate font-mono">{truncateMiddle(value, truncate)}</span>
      {!hideCopy && <CopyButton value={value} className="size-6" label="Copy object id" />}
    </span>
  );
}
