import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { formatCount } from '@/lib/formatters';
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
  /** some selected videos are public, so Make private has something to do */
  canMakePrivate: boolean;
  /** some selected videos are private, so Make public has something to do */
  canMakePublic: boolean;
  /** some selected videos are ready, so they have embed code to copy */
  canCopyEmbed: boolean;
  onSelectAll: () => void;
  onMakePublic: () => void;
  onMakePrivate: () => void;
  onCopyEmbed: () => void;
  onDelete: () => void;
  onClear: () => void;
  className?: string;
}

// keep toasts above the bar while it shows (the toaster reads this, D-20)
const LIFT = '--toast-lift';

// the board's buttons on the dark bar: 32px, an edge in the bar's line colour,
// and the bar's own text colour for the focus ring, since petrol would sit
// too close to the bar's dark fill
const ON_BAR =
  'h-8 border-bar-border bg-transparent px-3 text-bar-foreground hover:bg-white/10 hover:text-bar-foreground focus-visible:outline-bar-foreground';

/**
 * What can be done with the selected videos: the board's dark bar. It sticks
 * to the bottom of the content column, not the window, so it centers on
 * what it acts on (VIS-18), and rises in like every other new surface.
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
  canMakePrivate,
  canMakePublic,
  canCopyEmbed,
  onSelectAll,
  onMakePublic,
  onMakePrivate,
  onCopyEmbed,
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
    <div
      ref={ref}
      role="toolbar"
      aria-label="Selected videos"
      className={cn(
        'z-20 mx-auto flex w-fit max-w-full animate-enter flex-col gap-1 rounded-xl bg-bar py-2.5 pr-3 pl-4.5 text-sm text-bar-foreground shadow-toast',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-semibold whitespace-nowrap tabular-nums">
          {/* the page-level status region announces the count; this is the visible copy */}
          {formatCount(count)} selected
        </span>
        {canMakePublic && (
          <Button variant="outline" className={ON_BAR} disabled={busy} onClick={onMakePublic}>
            {changing === 'public' && <Spinner aria-hidden="true" />}
            Make public
          </Button>
        )}
        {canMakePrivate && (
          <Button variant="outline" className={ON_BAR} disabled={busy} onClick={onMakePrivate}>
            {changing === 'private' && <Spinner aria-hidden="true" />}
            Make private
          </Button>
        )}
        <Button
          variant="outline"
          className={ON_BAR}
          disabled={busy || !canCopyEmbed}
          title={canCopyEmbed ? undefined : 'Only ready videos have embed code'}
          onClick={onCopyEmbed}
        >
          Copy embed code
        </Button>
        <Button
          variant="outline"
          className={cn(
            ON_BAR,
            'border-bar-destructive-border font-semibold text-bar-destructive hover:text-bar-destructive',
          )}
          disabled={busy}
          onClick={onDelete}
        >
          Delete
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Clear selection"
          className="text-bar-foreground hover:bg-white/10 hover:text-bar-foreground focus-visible:outline-bar-foreground"
          onClick={onClear}
        >
          <X />
        </Button>
      </div>
      {(offerAll || acrossPages) && (
        <p className="flex flex-wrap items-center gap-x-1 pr-2 pb-0.5 text-xs text-bar-muted">
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
                className="h-auto px-0 text-xs text-bar-foreground hover:text-bar-foreground focus-visible:outline-bar-foreground"
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
    </div>
  );
}
