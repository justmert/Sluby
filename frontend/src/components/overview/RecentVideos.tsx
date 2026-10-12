import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { VideoAsset } from '@sluby/sdk';
import * as m from 'motion/react-m';
import { AssetThumbnail } from '@/components/asset/AssetThumbnail';
import { AnimatedItem, AnimatedList } from '@/components/motion';
import { EmptyState } from '@/components/shared/EmptyState';
import { InlineError } from '@/components/shared/InlineError';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useRowJob } from '@/components/videos/video-progress';
import { InlineProgress, VideoStatusChip } from '@/components/videos/VideoStatusChip';
import { ROUTES } from '@/lib/constants';
import { NO_VALUE, formatCount, formatDate, formatRelativeTime } from '@/lib/formatters';
import { Icons } from '@/lib/icons';
import { highlight, lateReveal } from '@/lib/motion';
import { cn } from '@/lib/utils';

// the board's cells: 24px at the card's edges, 12px between
const CELL = 'px-3 py-2.5';
const FIRST = 'pl-6';
const LAST = 'pr-6';

function VideoRow({ video }: { video: VideoAsset }) {
  const { progress } = useRowJob(video);
  // a soft ring that fades once when the row turns ready while on screen
  const [seen, setSeen] = useState({ status: video.status, flashes: 0 });
  if (seen.status !== video.status) {
    setSeen({ status: video.status, flashes: seen.flashes + (video.status === 'ready' ? 1 : 0) });
  }
  const ready = video.status === 'ready';
  return (
    <>
      <td className={cn(CELL, FIRST, 'relative')}>
        {seen.flashes > 0 && (
          <m.span
            key={seen.flashes}
            aria-hidden="true"
            data-slot="ready-flash"
            initial={{ opacity: 1 }}
            animate={{ opacity: 0 }}
            transition={highlight}
            className="pointer-events-none absolute inset-0 ring-2 ring-success/50 ring-inset"
          />
        )}
        <div className="flex min-w-0 items-center gap-3">
          <AssetThumbnail
            thumbnailObjectIds={video.thumbnailObjectIds}
            isPrivate={video.accessTier === 'private'}
            processing={progress}
            failed={video.status === 'failed'}
            className="w-16 rounded-[6px]"
          />
          <div className="min-w-0">
            <Link
              to={ROUTES.video(video.id)}
              dir="auto"
              className="line-clamp-2 rounded-sm font-semibold text-foreground wrap-anywhere hover:text-primary"
            >
              {video.title}
            </Link>
            {progress && <InlineProgress progress={progress} title={video.title} />}
          </div>
        </div>
      </td>
      <td className={CELL}>
        <VideoStatusChip asset={video} progress={progress} percent />
      </td>
      <td className={CELL}>{video.accessTier === 'private' ? 'Private' : 'Public'}</td>
      <td className={cn(CELL, 'text-right tabular-nums', !ready && 'text-subtle-foreground')}>
        {ready ? formatCount(video.playCount) : NO_VALUE}
      </td>
      <td className={cn(CELL, LAST, 'text-right whitespace-nowrap text-muted-foreground')}>
        <time dateTime={video.createdAt} title={formatDate(video.createdAt)}>
          {formatRelativeTime(video.createdAt)}
        </time>
      </td>
    </>
  );
}

const ROW =
  'border-t border-border-soft transition-colors duration-150 ease-design hover:bg-background';

function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table aria-label="Recent videos" className="w-full min-w-160 border-collapse">
        <thead>
          <tr className="bg-background text-left text-xs text-muted-foreground">
            <th scope="col" className={cn(CELL, FIRST, 'font-semibold')}>
              Video
            </th>
            <th scope="col" className={cn(CELL, 'font-semibold')}>
              Status
            </th>
            <th scope="col" className={cn(CELL, 'font-semibold')}>
              Access
            </th>
            <th scope="col" className={cn(CELL, 'text-right font-semibold')}>
              Plays
            </th>
            <th scope="col" className={cn(CELL, LAST, 'text-right font-semibold')}>
              Uploaded
            </th>
          </tr>
        </thead>
        {children}
      </table>
    </div>
  );
}

export function RecentLoading({ count }: { count: number }) {
  return (
    <Table>
      <tbody aria-hidden="true">
        {Array.from({ length: count }, (_, i) => (
          <tr key={i} className="border-t border-border-soft">
            <td className={cn(CELL, FIRST)}>
              <div className="flex items-center gap-3">
                <Skeleton className={cn('aspect-video w-16', lateReveal)} />
                <Skeleton className={cn('h-3.5 w-40', lateReveal)} />
              </div>
            </td>
            <td className={CELL}>
              <Skeleton className={cn('h-5.5 w-16 rounded-full', lateReveal)} />
            </td>
            <td className={CELL}>
              <Skeleton className={cn('h-3.5 w-12', lateReveal)} />
            </td>
            <td className={CELL}>
              <Skeleton className={cn('ml-auto h-3.5 w-8', lateReveal)} />
            </td>
            <td className={cn(CELL, LAST)}>
              <Skeleton className={cn('ml-auto h-3.5 w-20', lateReveal)} />
            </td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** The card around the list, also drawn by the route skeleton. */
export function RecentFrame({ children }: { children: ReactNode }) {
  return (
    <section aria-labelledby="recent-videos" className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-center px-6 py-4">
        <h2 id="recent-videos" className="font-heading text-heading">
          Recent videos
        </h2>
        <Link
          to={ROUTES.VIDEOS}
          className="ml-auto rounded-sm font-semibold text-primary hover:text-primary-hover"
        >
          All videos
        </Link>
      </div>
      {children}
    </section>
  );
}

/** The newest videos, with the stage and progress of the ones processing. */
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
        <div className="px-6 pb-5">
          <InlineError what="your videos" error={error} onRetry={onRetry} retrying={retrying} />
        </div>
      ) : !videos ? (
        <RecentLoading count={placeholders} />
      ) : videos.length === 0 ? (
        <div className="border-t border-border-soft">
          <EmptyState
            icon={Icons.video}
            title={stalled > 0 ? 'No finished videos yet' : 'No videos yet'}
            description={
              stalled > 0
                ? 'Uploads that did not finish are listed under Needs attention.'
                : 'Upload a file. It plays on your site once it is stored on Sia.'
            }
            action={
              <>
                <Button asChild>
                  <Link to={ROUTES.UPLOAD}>Upload video</Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link to={ROUTES.DEVELOPERS}>Quickstart</Link>
                </Button>
              </>
            }
          />
        </div>
      ) : (
        <Table>
          {/* rows on screen when the list mounts are simply there; later
              uploads fade in and deleted ones fade out */}
          <AnimatedList as="tbody" initial={false}>
            {videos.map((video) => (
              <AnimatedItem key={video.id} as="tr" className={ROW}>
                <VideoRow video={video} />
              </AnimatedItem>
            ))}
          </AnimatedList>
        </Table>
      )}
    </RecentFrame>
  );
}
