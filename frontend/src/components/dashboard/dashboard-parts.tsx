// the overview's stat row and its first draw, shared by the page and by the
// route skeleton, so the skeleton shown while the page's code loads is the
// one the page shows while its data loads
import type { ReactNode } from 'react';
import { AnimatedItem, AnimatedList, FadeSwap } from '@/components/motion';
import { AttentionFrame } from '@/components/overview/NeedsAttention';
import { RecentFrame, RecentLoading } from '@/components/overview/RecentVideos';
import { StatusFrame, StatusBadgeLoading, StatusLoading } from '@/components/overview/StatusCard';
import { StatValue } from '@/components/shared/StatValue';
import { Skeleton } from '@/components/ui/skeleton';
import type { AssetStats, SystemStatus } from '@/hooks/useStats';
import { lastDays, type Usage } from '@/hooks/useUsage';
import { NO_VALUE, formatBytes, formatCount, formatDuration } from '@/lib/formatters';
import { lateReveal } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { DASH, rememberedRows } from './dashboard-layout';

/**
 * "4 ready · 1 failed · 1 processing · 2 waiting for file": every status
 * with videos in it, so the parts add up to the total. An upload is not
 * called processing: it may have stopped with its browser.
 */
function videosBreakdown(s: AssetStats): string {
  if (s.total === 0) return 'None yet';
  const parts = [`${formatCount(s.by_status.ready)} ready`];
  if (s.by_status.failed) parts.push(`${formatCount(s.by_status.failed)} failed`);
  if (s.by_status.processing) parts.push(`${formatCount(s.by_status.processing)} processing`);
  if (s.by_status.uploading) parts.push(`${formatCount(s.by_status.uploading)} uploading`);
  if (s.by_status.created) parts.push(`${formatCount(s.by_status.created)} waiting for file`);
  return parts.join(' · ');
}

/** "of 50 GB" for an admin who can see the Sia account's limit. */
function storedHint(status: SystemStatus | undefined): string {
  const account = status?.scope === 'deployment' ? status.indexer.account : null;
  return account && account.max_pinned_data > 0
    ? `of ${formatBytes(account.max_pinned_data)}`
    : 'before Sia adds redundancy';
}

/**
 * One stat card from the board: the label, the figure (28/36 700, tabular)
 * and a hint line, all in the card's own padding, with no icon.
 */
function Stat({
  label,
  value,
  format,
  failed,
  hint,
}: {
  label: string;
  /** undefined while loading */
  value: number | undefined;
  format: (n: number) => string;
  failed: boolean;
  /** null while it waits on the same data as the figure */
  hint: ReactNode;
}) {
  const loading = value === undefined && !failed;
  return (
    <div className="h-full rounded-xl border bg-card px-5 py-4.5">
      <p className="font-medium text-muted-foreground">{label}</p>
      <FadeSwap swapKey={loading ? 'loading' : 'ready'}>
        {loading ? (
          <StatValue value={undefined} className={cn('my-0.5 h-8', lateReveal)} />
        ) : value === undefined ? (
          <span
            data-slot="stat-value"
            className="block font-heading text-figure text-muted-foreground"
            aria-label={`${NO_VALUE}, could not load`}
          >
            {NO_VALUE}
          </span>
        ) : (
          <StatValue value={value} format={format} />
        )}
      </FadeSwap>
      <div className="min-h-5 text-[13px] text-subtle-foreground">
        {hint === null ? (
          failed ? null : (
            <Skeleton className={cn('my-1 h-3 w-28 max-w-full', lateReveal)} />
          )
        ) : (
          hint
        )}
      </div>
    </div>
  );
}

/** The four stat cards; `s` and `usage` undefined while loading. */
export function OverviewStats({
  s,
  usage,
  status,
  failed = false,
  usageFailed = false,
  stagger = false,
}: {
  s?: AssetStats;
  usage?: Usage;
  status?: SystemStatus;
  failed?: boolean;
  usageFailed?: boolean;
  stagger?: boolean;
}) {
  const plays = usage && lastDays(usage);
  return (
    <AnimatedList
      as="div"
      initial={stagger ? 'hidden' : false}
      aria-label="Totals"
      role="list"
      className={DASH.stats}
    >
      <AnimatedItem as="div" role="listitem" key="videos" layout={false}>
        <Stat
          label="Videos"
          value={s?.total}
          format={formatCount}
          failed={failed}
          hint={s ? videosBreakdown(s) : failed ? 'Could not load' : null}
        />
      </AnimatedItem>
      <AnimatedItem as="div" role="listitem" key="stored" layout={false}>
        <Stat
          label="Stored on Sia"
          value={s?.stored_bytes}
          format={formatBytes}
          failed={failed}
          hint={s ? storedHint(status) : failed ? 'Could not load' : null}
        />
      </AnimatedItem>
      <AnimatedItem as="div" role="listitem" key="playtime" layout={false}>
        <Stat
          label="Playable time"
          value={s?.ready_duration_ms}
          format={formatDuration}
          failed={failed}
          hint="across ready videos"
        />
      </AnimatedItem>
      <AnimatedItem as="div" role="listitem" key="plays" layout={false}>
        <Stat
          label="Plays, last 30 days"
          value={plays?.total}
          format={formatCount}
          failed={usageFailed}
          hint={
            plays
              ? plays.total === 0
                ? 'No plays yet'
                : 'from your sites'
              : usageFailed
                ? 'Could not load'
                : null
          }
        />
      </AnimatedItem>
    </AnimatedList>
  );
}

/**
 * The overview as it first draws, before any answer: what the route
 * skeleton shows while the page's code loads, and what the page shows until
 * its first answers are in. The checklist is left out: nothing says yet
 * whether it will be there.
 */
export function DashboardLoading(_: { admin?: boolean }) {
  return (
    <div className={DASH.page}>
      <OverviewStats />
      <div className={DASH.middle}>
        <AttentionFrame>
          <div className="flex flex-col gap-3 border-t border-border-soft px-2 py-3">
            <Skeleton className={cn('h-3.5 w-3/5', lateReveal)} />
            <Skeleton className={cn('h-3 w-2/5', lateReveal)} />
          </div>
        </AttentionFrame>
        <StatusFrame badge={<StatusBadgeLoading />}>
          <StatusLoading />
        </StatusFrame>
      </div>
      <RecentFrame>
        <RecentLoading count={rememberedRows() ?? 3} />
      </RecentFrame>
    </div>
  );
}
