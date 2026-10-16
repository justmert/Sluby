import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { VideoAsset } from '@sluby/sdk';
import { AssetThumbnail } from '@/components/asset/AssetThumbnail';
import { RetryProcessingButton } from '@/components/asset/RetryProcessingButton';
import { AnimatedItem, AnimatedList } from '@/components/motion';
import type { RowAction, SortState } from '@/components/shared/DataTable';
import { selectRange } from '@/components/shared/select-range';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { isStaleUpload, useSendingAssetIds } from '@/hooks/asset-queries';
import { ROUTES } from '@/lib/constants';
import {
  NO_VALUE,
  formatBytes,
  formatCount,
  formatDate,
  formatDuration,
  formatRelativeTime,
} from '@/lib/formatters';
import { lateReveal } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useRowJob } from './video-progress';
import { InlineProgress, VideoStatusChip } from './VideoStatusChip';
import { VideoRowMenu } from './VideoRowMenu';

// the board's cells: 10px by 12px, the first column 20px in from the card edge
const CELL = 'px-3 py-2.5';
const dash = <span className="text-subtle-foreground">{NO_VALUE}</span>;

/** The video column: thumbnail, title, and the short id or what the video is doing. */
function VideoCell({ asset }: { asset: VideoAsset }) {
  const { progress, progressPending, failure, failurePending } = useRowJob(asset);
  // an old upload another tab is still sending is not interrupted
  const sending = useSendingAssetIds();
  const stale = isStaleUpload(asset) && !sending.has(asset.id);
  const href = ROUTES.video(asset.id);
  return (
    <div className="flex min-w-0 items-center gap-3">
      {/* the title link names the video; this one is a larger mouse target */}
      <Link to={href} tabIndex={-1} aria-hidden="true" className="shrink-0">
        <AssetThumbnail
          thumbnailObjectIds={asset.thumbnailObjectIds}
          isPrivate={asset.accessTier === 'private'}
          processing={progress}
          failed={asset.status === 'failed'}
          className="w-20 rounded-[6px]"
        />
      </Link>
      <div className="max-w-80 min-w-0">
        <Link
          to={href}
          data-video-link={asset.id}
          dir="auto"
          title={asset.title}
          className="block truncate rounded-sm font-semibold text-foreground hover:text-primary"
        >
          {asset.title}
        </Link>
        {progress ? (
          <InlineProgress progress={progress} title={asset.title} className="mt-1" />
        ) : progressPending ? (
          // the bar's line, held open until the job answers
          <span className="mt-1 flex h-4.5 items-center" aria-hidden="true">
            <Skeleton className={cn('h-1 w-30', lateReveal)} />
          </span>
        ) : failurePending ? (
          <span className="flex h-4.5 items-center">
            <Skeleton className={cn('h-3 w-36', lateReveal)} />
          </span>
        ) : failure ? (
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-xs text-destructive">{failure.body}</span>
            {failure.action === 'retry' && (
              <RetryProcessingButton asset={asset} named compact variant="outline" size="xs" />
            )}
          </span>
        ) : stale ? (
          <span className="block text-xs text-muted-foreground">Upload interrupted</span>
        ) : (
          <span className="block font-mono text-xs text-subtle-foreground">
            {asset.id.slice(0, 8)}
          </span>
        )}
      </div>
    </div>
  );
}

function StatusCell({ asset }: { asset: VideoAsset }) {
  const { progress } = useRowJob(asset);
  const sending = useSendingAssetIds();
  const stale = isStaleUpload(asset) && !sending.has(asset.id);
  return <VideoStatusChip asset={asset} progress={progress} stale={stale} />;
}

type ColumnId = 'title' | 'duration' | 'size' | 'created';

/** A sortable header: the words, and an arrow only on the column the list is sorted by. */
function SortButton({
  id,
  label,
  sort,
  onSortChange,
  right = false,
}: {
  id: ColumnId;
  label: string;
  sort: SortState;
  onSortChange: (sort: SortState) => void;
  right?: boolean;
}) {
  const active = sort.column === id;
  const Arrow = sort.direction === 'asc' ? ArrowUp : ArrowDown;
  const next: SortState = active
    ? { column: id, direction: sort.direction === 'asc' ? 'desc' : 'asc' }
    : { column: id, direction: right ? 'desc' : 'asc' };
  return (
    <button
      type="button"
      onClick={() => onSortChange(next)}
      className={cn(
        'inline-flex items-center gap-1 rounded-sm font-semibold hover:text-foreground',
        active ? 'text-foreground' : 'text-muted-foreground',
      )}
    >
      {label}
      {active && <Arrow aria-hidden="true" strokeWidth={2.4} className="size-3" />}
    </button>
  );
}

export interface VideosTableProps {
  /** undefined while the first page loads: skeleton rows */
  assets: VideoAsset[] | undefined;
  sort: SortState;
  onSortChange: (sort: SortState) => void;
  selected: ReadonlySet<string>;
  onSelectedChange: (next: Set<string>) => void;
  actions: (asset: VideoAsset) => RowAction[];
  /** the first rows this page shows, so they may stagger in */
  staggerIn: boolean;
  busy: boolean;
  /** the query the rows answer; a new one swaps them without motion */
  rowsKey: string;
  /** the pagination row, inside the card under the table */
  footer?: ReactNode;
}

/**
 * The library as a table, the default view (D-09). The board's columns,
 * each sortable one a plain header button; on a narrow content column the
 * table scrolls sideways inside its card (phones get cards instead, see
 * VideosCards). Shift-click on a checkbox selects a range.
 */
export function VideosTable({
  assets,
  sort,
  onSortChange,
  selected,
  onSelectedChange,
  actions,
  staggerIn,
  busy,
  rowsKey,
  footer,
}: VideosTableProps) {
  const loading = assets === undefined;
  const ids = assets?.map((a) => a.id) ?? [];
  const selectedHere = ids.filter((id) => selected.has(id)).length;
  const allState: boolean | 'indeterminate' =
    selectedHere === 0 ? false : selectedHere === ids.length ? true : 'indeterminate';
  const toggleAll = () => {
    const next = new Set(selected);
    if (allState === true) ids.forEach((id) => next.delete(id));
    else ids.forEach((id) => next.add(id));
    onSelectedChange(next);
  };
  // the last row toggled, and whether shift was down on the click that is
  // about to toggle a row (radix reports the click before the change)
  const anchor = useRef<string | null>(null);
  const shift = useRef(false);
  const toggle = (id: string) => {
    onSelectedChange(
      selectRange(ids, selected, shift.current ? anchor.current : null, id, !selected.has(id)),
    );
    anchor.current = id;
    shift.current = false;
  };
  // the rows each set started with stay still; rows a later poll adds fade
  // in. the first set may stagger in when the page asks
  const [first] = useState(rowsKey);
  const [mounted, setMounted] = useState({ key: rowsKey, ids: new Set(ids) });
  const current = mounted.key === rowsKey ? mounted : { key: rowsKey, ids: new Set(ids) };
  if (current !== mounted) setMounted(current);
  const initialFor = (id: string) =>
    (staggerIn && rowsKey === first) || !current.ids.has(id) ? undefined : false;

  const sortProps = { sort, onSortChange };
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="overflow-x-auto">
        <table
          aria-label="Videos"
          aria-busy={loading || busy || undefined}
          className="w-full min-w-220 border-collapse"
        >
          <thead>
            <tr className="bg-background text-left text-xs text-muted-foreground">
              <th scope="col" className={cn(CELL, 'w-10 pl-5')}>
                <Checkbox
                  checked={allState}
                  onCheckedChange={toggleAll}
                  disabled={!assets || assets.length === 0}
                  aria-label="Select all on this page"
                />
              </th>
              <th
                scope="col"
                aria-sort={sortOf(sort, 'title')}
                className={cn(CELL, 'font-semibold')}
              >
                <SortButton id="title" label="Video" {...sortProps} />
              </th>
              <th scope="col" className={cn(CELL, 'font-semibold')}>
                Status
              </th>
              <th scope="col" className={cn(CELL, 'font-semibold')}>
                Access
              </th>
              <th
                scope="col"
                aria-sort={sortOf(sort, 'duration')}
                className={cn(CELL, 'text-right font-semibold')}
              >
                <SortButton id="duration" label="Length" right {...sortProps} />
              </th>
              <th scope="col" className={cn(CELL, 'text-right font-semibold')}>
                Plays
              </th>
              <th
                scope="col"
                aria-sort={sortOf(sort, 'size')}
                className={cn(CELL, 'text-right font-semibold')}
              >
                <SortButton id="size" label="Size" right {...sortProps} />
              </th>
              <th
                scope="col"
                aria-sort={sortOf(sort, 'created')}
                className={cn(CELL, 'text-right font-semibold')}
              >
                <SortButton id="created" label="Uploaded" right {...sortProps} />
              </th>
              <th scope="col" className={cn(CELL, 'w-12')}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          {loading ? (
            <tbody aria-hidden="true">
              {Array.from({ length: 8 }, (_, r) => (
                <tr key={r} className="border-t border-border-soft">
                  <td className={cn(CELL, 'pl-5')}>
                    <Skeleton className={cn('size-4', lateReveal)} />
                  </td>
                  <td className={CELL}>
                    <div className="flex items-center gap-3">
                      <Skeleton className={cn('aspect-video w-20 shrink-0', lateReveal)} />
                      <div className="flex flex-1 flex-col gap-2">
                        <Skeleton className={cn('h-3.5 w-3/5', lateReveal)} />
                        <Skeleton className={cn('h-3 w-16', lateReveal)} />
                      </div>
                    </div>
                  </td>
                  <td className={CELL}>
                    <Skeleton className={cn('h-5.5 w-16 rounded-full', lateReveal)} />
                  </td>
                  <td className={CELL}>
                    <Skeleton className={cn('h-3.5 w-12', lateReveal)} />
                  </td>
                  {['w-10', 'w-8', 'w-12', 'w-14'].map((w, i) => (
                    <td key={i} className={CELL}>
                      <Skeleton className={cn('ml-auto h-3.5', w, lateReveal)} />
                    </td>
                  ))}
                  <td className={CELL} />
                </tr>
              ))}
            </tbody>
          ) : (
            <AnimatedList key={rowsKey} as="tbody">
              {assets.map((asset) => {
                const isSelected = selected.has(asset.id);
                const ready = asset.status === 'ready';
                return (
                  <AnimatedItem
                    key={asset.id}
                    as="tr"
                    data-row-id={asset.id}
                    data-state={isSelected ? 'selected' : undefined}
                    initial={initialFor(asset.id)}
                    className={cn(
                      'border-t border-border-soft transition-colors duration-150 ease-design',
                      isSelected
                        ? 'bg-muted'
                        : 'hover:bg-background has-aria-expanded:bg-background',
                    )}
                  >
                    <td className={cn(CELL, 'pl-5')}>
                      <Checkbox
                        checked={isSelected}
                        onClick={(e) => (shift.current = e.shiftKey)}
                        onCheckedChange={() => toggle(asset.id)}
                        aria-label={`Select ${asset.title}`}
                      />
                    </td>
                    <td className={CELL}>
                      <VideoCell asset={asset} />
                    </td>
                    <td className={CELL}>
                      <StatusCell asset={asset} />
                    </td>
                    <td className={CELL}>
                      {asset.accessTier === 'private' ? 'Private' : 'Public'}
                    </td>
                    <td className={cn(CELL, 'text-right tabular-nums')}>
                      {asset.durationMs ? formatDuration(asset.durationMs) : dash}
                    </td>
                    <td className={cn(CELL, 'text-right tabular-nums')}>
                      {ready ? formatCount(asset.playCount) : dash}
                    </td>
                    <td className={cn(CELL, 'text-right tabular-nums')}>
                      {asset.totalStorageBytes > 0 ? formatBytes(asset.totalStorageBytes) : dash}
                    </td>
                    <td className={cn(CELL, 'text-right whitespace-nowrap text-muted-foreground')}>
                      <time dateTime={asset.createdAt} title={formatDate(asset.createdAt)}>
                        {formatRelativeTime(asset.createdAt)}
                      </time>
                    </td>
                    <td className={cn(CELL, 'pr-4')}>
                      <VideoRowMenu actions={actions(asset)} title={asset.title} />
                    </td>
                  </AnimatedItem>
                );
              })}
            </AnimatedList>
          )}
        </table>
      </div>
      {footer}
    </div>
  );
}

function sortOf(sort: SortState, id: ColumnId) {
  if (sort.column !== id) return undefined;
  return sort.direction === 'asc' ? 'ascending' : 'descending';
}
