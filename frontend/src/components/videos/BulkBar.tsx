import { useEffect, useRef } from 'react';
import * as m from 'motion/react-m';
import { Globe, Lock } from 'lucide-react';
import { NumberTicker } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { formatCount } from '@/lib/formatters';
import { Icons } from '@/lib/icons';
import { spring, transition } from '@/lib/motion';
import { cn } from '@/lib/utils';

export interface BulkBarProps {
  /** how many videos are selected */
  count: number;
  /** rows on this page */
  onPage: number;
  /** videos matching the filters, over every page */
  total: number;
  /** the selection spans every result, not just this page */
  acrossPages: boolean;
  /** "Select all results" is fetching the ids */
  selectingAll: boolean;
  /** the most "Select all results" takes */
  cap: number;
  /** an access change is running */
  changing: 'public' | 'private' | null;
  onSelectAll: () => void;
  onMakePublic: () => void;
  onMakePrivate: () => void;
  onDelete: () => void;
  onClear: () => void;
  className?: string;
}

// keep toasts above the bar while it shows (the toaster reads this, D-20)
const LIFT = '--toast-lift';

/**
 * What can be done with the selected videos. It sticks to the bottom of the
 * content column, not the window, so it centers on what it acts on (VIS-18).
 * Offers to widen a full page's selection to every result (FLW-43).
 */
export function BulkBar({
  count,
  onPage,
  total,
  acrossPages,
  selectingAll,
  cap,
  changing,
  onSelectAll,
  onMakePublic,
  onMakePrivate,
  onDelete,
  onClear,
  className,
}: BulkBarProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(LIFT, '4rem');
    // a control focused by Tab scrolls into view above the bar, not under it
    // (A11Y-25, WCAG 2.4.11): the page's bottom scroll padding (index.css)
    // follows the bar's height, which changes when it wraps on phones
    const el = ref.current;
    const pad = () => {
      if (el) root.style.setProperty('--bulk-bar-pad', `${el.offsetHeight + 32}px`);
    };
    pad();
    const observer = new ResizeObserver(pad);
    if (el) observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty(LIFT);
      root.style.removeProperty('--bulk-bar-pad');
    };
  }, []);

  const offerAll = !acrossPages && count === onPage && total > onPage;
  const busy = changing !== null;
  return (
    <m.div
      ref={ref}
      role="toolbar"
      aria-label="Selected videos"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0, transition: spring }}
      exit={{ opacity: 0, y: 16, transition: transition.fast }}
      className={cn(
        'z-20 mx-auto flex w-fit max-w-full flex-col gap-1 rounded-xl border bg-popover p-1.5 pl-4 text-sm text-popover-foreground shadow-lg',
        className,
      )}
    >
      {/* one row on wider screens; on phones the count and Clear share the
          first row and the actions get the second, instead of a ragged wrap */}
      <div className="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-1 sm:flex">
        <span className="mr-1 whitespace-nowrap tabular-nums">
          {/* the page-level status region announces the count; this is the visible copy */}
          <NumberTicker value={count} format={(n) => formatCount(Math.round(n))} />
          {!acrossPages && (
            <span className="max-[359px]:hidden"> of {formatCount(onPage)}</span>
          )}{' '}
          selected
        </span>
        <div className="col-span-2 row-start-2 -ml-2.5 flex flex-wrap items-center gap-1 sm:contents">
          <Button variant="ghost" size="sm" disabled={busy} onClick={onMakePublic}>
            {changing === 'public' ? <Spinner aria-hidden="true" /> : <Globe />}
            Make public
          </Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={onMakePrivate}>
            {changing === 'private' ? <Spinner aria-hidden="true" /> : <Lock />}
            Make private
          </Button>
          <Button variant="destructive-outline" size="sm" disabled={busy} onClick={onDelete}>
            <Icons.delete />
            Delete
          </Button>
        </div>
        <Button variant="ghost" size="sm" className="col-start-2 row-start-1" onClick={onClear}>
          Clear
        </Button>
      </div>
      {(offerAll || acrossPages) && (
        <p className="flex flex-wrap items-center gap-x-1 pr-2 pb-1 text-xs text-muted-foreground">
          {acrossPages ? (
            <span>
              {count < total
                ? `The first ${formatCount(count)} of ${formatCount(total)} results are selected.`
                : `All ${formatCount(count)} results are selected.`}
            </span>
          ) : (
            <>
              <span>All {formatCount(onPage)} on this page are selected.</span>
              <Button
                variant="link"
                size="sm"
                className="h-auto px-0 text-xs"
                disabled={selectingAll}
                onClick={onSelectAll}
              >
                {selectingAll && <Spinner aria-hidden="true" />}
                {total > cap
                  ? `Select the first ${formatCount(cap)} results`
                  : `Select all ${formatCount(total)} results`}
              </Button>
            </>
          )}
        </p>
      )}
    </m.div>
  );
}
