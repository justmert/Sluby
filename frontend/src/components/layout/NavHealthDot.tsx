import * as m from 'motion/react-m';
import { formatCount } from '@/lib/formatters';
import { transition } from '@/lib/motion';
import { cn } from '@/lib/utils';
import type { NavSignal } from './nav-signals';

const DOT_TONE = {
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
  neutral: 'bg-muted-foreground/60',
} as const;

/**
 * The visible part of a signal, after the label: a dot or a count at the end
 * of the row, and a small overlay on the icon when the sidebar is a rail.
 * It is hidden from screen readers, which hear `text` in the link's name.
 */
export function NavSignalMark({ signal }: { signal: NavSignal }) {
  return (
    <m.span
      // a 150 ms fade when it appears, nothing when it only changes
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={transition.fast}
      aria-hidden="true"
      data-slot="nav-signal"
      className={cn(
        'ml-auto flex shrink-0 items-center justify-center',
        'group-data-[collapsible=icon]:pointer-events-none group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:top-1 group-data-[collapsible=icon]:right-1',
      )}
    >
      {signal.kind === 'dot' ? (
        <span
          data-tone={signal.tone}
          className={cn(
            'size-2 rounded-full ring-2 ring-sidebar group-data-[collapsible=icon]:size-1.5',
            DOT_TONE[signal.tone],
          )}
        />
      ) : (
        <>
          <span className="min-w-5 rounded-full bg-sidebar-accent px-1.5 text-center text-kbd text-sidebar-foreground tabular-nums group-data-[collapsible=icon]:hidden">
            {formatCount(signal.count)}
          </span>
          {/* no room for a number on the rail; a dot in the progress color says "busy" */}
          <span className="hidden size-1.5 rounded-full bg-progress ring-2 ring-sidebar group-data-[collapsible=icon]:block" />
        </>
      )}
    </m.span>
  );
}
