import { Link } from 'react-router';
import type { VideoAsset } from '@sluby/sdk';
import { AssetThumbnail } from '@/components/asset/AssetThumbnail';
import { CopyButton } from '@/components/shared/CopyButton';
import {
  DataTable,
  type DataTableColumn,
  type RowAction,
  type SortState,
} from '@/components/shared/DataTable';
import { AccessBadge, StatusBadge } from '@/components/shared/StatusBadge';
import { Progress } from '@/components/ui/progress';
import { isStaleUpload } from '@/hooks/asset-queries';
import { ROUTES } from '@/lib/constants';
import {
  NO_VALUE,
  formatBytes,
  formatCount,
  formatDate,
  formatDuration,
  formatRelativeTime,
  truncateMiddle,
} from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { playsOf, useRowProgress, videoMeta } from './video-progress';

const muted = (text: string) => <span className="text-muted-foreground">{text}</span>;

function ProgressLine({
  label,
  percent,
  checking,
}: NonNullable<ReturnType<typeof useRowProgress>>) {
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-normal text-muted-foreground tabular-nums">
        {label}
        {checking && <span>. Checking again in a few seconds</span>}
      </span>
      {percent !== null && (
        <Progress smooth value={percent} aria-hidden="true" className="h-0.5 max-w-48" />
      )}
    </span>
  );
}

/** The video column: thumbnail, title, and a second line that depends on where the table is. */
function VideoCell({ asset }: { asset: VideoAsset }) {
  const progress = useRowProgress(asset);
  const stale = isStaleUpload(asset);
  const href = ROUTES.video(asset.id);
  return (
    <div className="flex min-w-0 items-start gap-3 font-normal">
      {/* the title link names the video; this one is a larger mouse target */}
      <Link to={href} tabIndex={-1} aria-hidden="true" className="shrink-0">
        <AssetThumbnail
          thumbnailObjectIds={asset.thumbnailObjectIds}
          isPrivate={asset.accessTier === 'private'}
          processing={progress}
          failed={asset.status === 'failed'}
          className="w-16"
        />
      </Link>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Link
          to={href}
          data-video-link={asset.id}
          dir="auto"
          className="line-clamp-2 rounded-sm font-medium wrap-anywhere whitespace-normal outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring"
        >
          {asset.title}
        </Link>
        {progress ? (
          <ProgressLine {...progress} />
        ) : stale ? (
          <span className="text-xs text-muted-foreground">Upload interrupted</span>
        ) : (
          // the id is for the table; the phone card shows facts instead
          <span className="hidden items-center gap-1 @min-[40rem]/table:flex">
            <code className="font-mono text-xs text-muted-foreground">
              {truncateMiddle(asset.id, 8)}
            </code>
            <CopyButton
              value={asset.id}
              label={`Copy video ID of ${asset.title}`}
              className="size-6 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
            />
          </span>
        )}
        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 @min-[40rem]/table:hidden">
          <StatusBadge kind="asset" status={asset.status} />
          <AccessBadge access={asset.accessTier} />
          <span className="text-xs text-muted-foreground">{videoMeta(asset)}</span>
        </span>
      </div>
    </div>
  );
}

const COLUMNS: DataTableColumn<VideoAsset>[] = [
  {
    id: 'title',
    header: 'Video',
    primary: true,
    sortable: true,
    cell: (a) => <VideoCell asset={a} />,
    className: 'whitespace-normal',
  },
  {
    id: 'status',
    header: 'Status',
    width: 'w-36',
    hideInCards: true,
    cell: (a) => <StatusBadge kind="asset" status={a.status} />,
  },
  {
    id: 'access',
    header: 'Access',
    width: 'w-24',
    hideInCards: true,
    // the column is never blank: public is plain text, private the badge (D-23)
    cell: (a) => (a.accessTier === 'private' ? <AccessBadge access="private" /> : muted('Public')),
  },
  {
    id: 'duration',
    header: 'Duration',
    align: 'right',
    width: 'w-24',
    hideBelow: '3xl',
    hideInCards: true,
    sortable: true,
    cell: (a) => (a.durationMs ? formatDuration(a.durationMs) : muted(NO_VALUE)),
  },
  {
    id: 'size',
    header: 'Size',
    align: 'right',
    width: 'w-24',
    hideBelow: '4xl',
    hideInCards: true,
    sortable: true,
    cell: (a) => (a.totalStorageBytes > 0 ? formatBytes(a.totalStorageBytes) : muted(NO_VALUE)),
  },
  {
    id: 'plays',
    header: 'Plays',
    align: 'right',
    width: 'w-20',
    hideBelow: '4xl',
    hideInCards: true,
    cell: (a) => {
      const n = playsOf(a);
      return n === undefined ? muted(NO_VALUE) : formatCount(n);
    },
  },
  {
    id: 'created',
    header: 'Created',
    width: 'w-32',
    hideBelow: '3xl',
    hideInCards: true,
    sortable: true,
    cell: (a) => (
      <time
        dateTime={a.createdAt}
        title={formatDate(a.createdAt)}
        className="text-muted-foreground"
      >
        {formatRelativeTime(a.createdAt)}
      </time>
    ),
  },
];

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
}

/**
 * The library as a table, the default view (D-09, RDS-09). Columns drop out
 * as the table narrows (Plays and Size first, then Duration and Created) and
 * below 40rem each row is a compact card: thumbnail, title, then status and
 * facts on one line (A11Y-07).
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
}: VideosTableProps) {
  return (
    <DataTable
      caption="Videos"
      columns={COLUMNS}
      rows={assets}
      getRowId={(a) => a.id}
      getRowLabel={(a) => a.title}
      sort={sort}
      onSortChange={onSortChange}
      selected={selected}
      onSelectedChange={onSelectedChange}
      rowActions={actions}
      rowClassName={() => cn('group/row scroll-mt-36')}
      layout="fixed"
      busy={busy}
      animateRows
      staggerIn={staggerIn}
      rowsKey={rowsKey}
      loadingRows={8}
    />
  );
}
