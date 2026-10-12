import { useState } from 'react';
import { Link } from 'react-router';
import type { VideoAsset } from '@sluby/sdk';
import * as m from 'motion/react-m';
import { AssetThumbnail } from '@/components/asset/AssetThumbnail';
import { RetryProcessingButton } from '@/components/asset/RetryProcessingButton';
import { failureInfo, processingView } from '@/components/asset/processing';
import { AnimatedItem, AnimatedList } from '@/components/motion';
import { EmptyState } from '@/components/shared/EmptyState';
import { InlineError } from '@/components/shared/InlineError';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useProcessingJob } from '@/hooks/asset-detail-queries';
import { ROUTES } from '@/lib/constants';
import { formatBytes, formatDuration, formatRelativeTime } from '@/lib/formatters';
import { Icons } from '@/lib/icons';
import { highlight, lateReveal } from '@/lib/motion';
import { cn } from '@/lib/utils';

/** What a processing video is doing now, with a thin bar along the row's bottom edge. */
function RowProgress({ video }: { video: VideoAsset }) {
  const job = useProcessingJob(video.id, video.status, video.status === 'processing', 5_000);
  if (video.status !== 'processing' || !job.data || job.data.status === 'failed') return null;
  const view = processingView(job.data);
  return (
    <>
      <span className="tabular-nums">
        {' · '}
        {view.label}
        {view.percent !== null && `, ${view.percent}%`}
      </span>
      {view.percent !== null && (
        <Progress
          smooth
          value={view.percent}
          aria-label={`${video.title}, processing progress`}
          // a quiet bar: the percentage beside it is the news, not the bar (VIS-30)
          className="absolute inset-x-2 bottom-0 h-0.5 bg-muted [&>[data-slot=progress-indicator]]:bg-progress/60"
        />
      )}
    </>
  );
}

/** Retry on a failed row, only when retrying can help (an unreadable file gets none). */
function RowRetry({ video }: { video: VideoAsset }) {
  const job = useProcessingJob(video.id, video.status, true);
  if (!job.data || failureInfo(job.data, video).action !== 'retry') return null;
  return (
    <RetryProcessingButton
      asset={video}
      named
      compact
      variant="ghost"
      size="sm"
      labelClassName="hidden @md/recent:inline"
    />
  );
}

function VideoRow({ video }: { video: VideoAsset }) {
  // a soft ring that fades once when the row turns ready while on screen
  const [seen, setSeen] = useState({ status: video.status, flashes: 0 });
  if (seen.status !== video.status) {
    setSeen({ status: video.status, flashes: seen.flashes + (video.status === 'ready' ? 1 : 0) });
  }
  return (
    <div className="flex items-center gap-1">
      <Link
        to={ROUTES.video(video.id)}
        className="relative -mx-2 flex min-w-0 flex-1 items-center gap-3 rounded-md px-2 py-2.5 outline-none transition-colors duration-150 hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring"
      >
        {seen.flashes > 0 && (
          <m.span
            key={seen.flashes}
            aria-hidden="true"
            data-slot="ready-flash"
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            transition={highlight}
            className="pointer-events-none absolute inset-0 rounded-md ring-2 ring-success/50"
          />
        )}
        <AssetThumbnail
          thumbnailObjectIds={video.thumbnailObjectIds}
          isPrivate={video.accessTier === 'private'}
          failed={video.status === 'failed'}
          className="w-16 shrink-0 @md/recent:w-20"
        />
        <div className="min-w-0 flex-1">
          <p dir="auto" className="line-clamp-2 text-sm font-medium wrap-anywhere">
            {video.title}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {formatRelativeTime(video.createdAt)}
            {!!video.durationMs && ` · ${formatDuration(video.durationMs)}`}
            {video.status === 'ready' &&
              video.totalStorageBytes > 0 &&
              ` · ${formatBytes(video.totalStorageBytes)}`}
            <RowProgress video={video} />
          </p>
        </div>
        <StatusBadge kind="asset" status={video.status} busy="dot" className="shrink-0" />
      </Link>
      {video.status === 'failed' && <RowRetry video={video} />}
    </div>
  );
}

export function RecentLoading({ count }: { count: number }) {
  return (
    <div className="flex flex-col divide-y" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-3 py-2.5">
          <Skeleton className={cn('aspect-video w-16 @md/recent:w-20', lateReveal)} />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className={cn('h-3.5 w-2/5', lateReveal)} />
            <Skeleton className={cn('h-3 w-1/4', lateReveal)} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The card around the list, also drawn by the route skeleton. */
export function RecentFrame({ children }: { children: React.ReactNode }) {
  return (
    <Card className="@container/recent h-full">
      <CardHeader>
        <CardTitle>Recent videos</CardTitle>
        <CardAction>
          <Button variant="ghost" size="sm" asChild>
            <Link to={ROUTES.VIDEOS}>View all</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** The newest videos, live progress on the ones processing, retry on the failed ones. */
export function RecentVideos({
  videos,
  error,
  onRetry,
  retrying,
  placeholders,
  stalled = 0,
}: {
  /** undefined while loading */
  videos?: VideoAsset[];
  /** uploads left out of the list because their file never came (they show under Needs attention) */
  stalled?: number;
  error: Error | null;
  onRetry: () => void;
  retrying: boolean;
  placeholders: number;
}) {
  return (
    <RecentFrame>
      {!videos && error ? (
        <InlineError what="your videos" error={error} onRetry={onRetry} retrying={retrying} />
      ) : !videos ? (
        <RecentLoading count={placeholders} />
      ) : videos.length === 0 ? (
        <EmptyState
          icon={Icons.video}
          title={stalled > 0 ? 'No finished videos yet' : 'No videos yet'}
          description={
            stalled > 0
              ? 'Uploads that did not finish are listed under Needs attention.'
              : 'Upload a video and it will be ready to stream in a few minutes.'
          }
          action={
            // outline: the page header already has the one primary upload button
            <Button variant="outline" asChild>
              <Link to={ROUTES.UPLOAD}>
                <Icons.upload />
                Upload video
              </Link>
            </Button>
          }
        />
      ) : (
        // rows on screen when the list mounts are simply there; later
        // uploads fade in and deleted ones fade out
        <AnimatedList initial={false} aria-label="Recent videos" className="flex flex-col divide-y">
          {videos.map((video) => (
            <AnimatedItem key={video.id}>
              <VideoRow video={video} />
            </AnimatedItem>
          ))}
        </AnimatedList>
      )}
    </RecentFrame>
  );
}
