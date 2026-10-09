// the overview's stat row and its first draw, shared by the page and by the
// route skeleton, so the skeleton shown while the page's code loads is the
// one the page shows while its data loads
import { Play } from 'lucide-react';
import { AnimatedItem, AnimatedList } from '@/components/motion';
import { RecentFrame, RecentLoading } from '@/components/overview/RecentVideos';
import { StatusFrame, StatusBadgeLoading, StatusLoading } from '@/components/overview/StatusCard';
import { PlaysSparkline } from '@/components/overview/PlaysSparkline';
import { StatCard } from '@/components/shared/StatCard';
import type { AssetStats } from '@/hooks/useStats';
import { lastDays, type Usage } from '@/hooks/useUsage';
import { formatBytes, formatCount, formatDuration } from '@/lib/formatters';
import { Icons } from '@/lib/icons';
import { cn } from '@/lib/utils';
import { DASH, rememberedRows } from './dashboard-layout';

/**
 * "3 ready, 1 failed, 1 processing, 2 waiting for file": every status with
 * videos in it, so the parts add up to the total.
 */
function videosBreakdown(s: AssetStats): string {
  if (s.total === 0) return 'None yet';
  const parts = [`${formatCount(s.by_status.ready)} ready`];
  if (s.by_status.failed) parts.push(`${formatCount(s.by_status.failed)} failed`);
  const moving = s.by_status.uploading + s.by_status.processing;
  if (moving) parts.push(`${formatCount(moving)} processing`);
  if (s.by_status.created) parts.push(`${formatCount(s.by_status.created)} waiting for file`);
  return parts.join(', ');
}

/** The four stat cards; `s` and `usage` undefined while loading, usage null when plays are not counted. */
export function OverviewStats({
  s,
  usage,
  failed = false,
  usageFailed = false,
  stagger = false,
}: {
  s?: AssetStats;
  usage?: Usage | null;
  failed?: boolean;
  usageFailed?: boolean;
  stagger?: boolean;
}) {
  const plays = usage ? lastDays(usage) : usage;
  return (
    <AnimatedList
      as="div"
      initial={stagger ? 'hidden' : false}
      aria-label="Totals"
      role="list"
      className={DASH.stats}
    >
      <AnimatedItem as="div" role="listitem" key="videos" layout={false}>
        <StatCard
          icon={Icons.video}
          label="Videos"
          value={s?.total}
          format={formatCount}
          failed={failed}
          hint={s ? videosBreakdown(s) : null}
          longHint
        />
      </AnimatedItem>
      <AnimatedItem as="div" role="listitem" key="stored" layout={false}>
        <StatCard
          icon={Icons.storeOnSia}
          label="Stored on Sia"
          value={s?.stored_bytes}
          format={formatBytes}
          failed={failed}
          hint="Your files' size, before Sia adds redundancy"
          longHint
        />
      </AnimatedItem>
      <AnimatedItem as="div" role="listitem" key="playtime" layout={false}>
        <StatCard
          icon={Icons.playtime}
          label="Playable time"
          value={s?.ready_duration_ms}
          format={formatDuration}
          failed={failed}
          hint="Ready videos"
        />
      </AnimatedItem>
      <AnimatedItem as="div" role="listitem" key="plays" layout={false}>
        <StatCard
          icon={Play}
          label="Plays, last 30 days"
          value={plays === undefined ? undefined : plays === null ? null : plays.total}
          format={formatCount}
          failed={usageFailed}
          hint={
            plays === undefined ? (
              usageFailed ? undefined : null
            ) : plays === null ? (
              'Not counted on this server'
            ) : (
              <PlaysSparkline days={plays.days} className="my-0.5 h-3" />
            )
          }
        />
      </AnimatedItem>
    </AnimatedList>
  );
}

/**
 * The overview as it first draws, before any answer: what the route
 * skeleton shows while the page's code loads, and what the page shows until
 * its first answers are in. The checklist and Needs attention are left out:
 * nothing says yet whether they will be there.
 */
export function DashboardLoading(_: { operator?: boolean }) {
  return (
    <>
      <OverviewStats />
      <p aria-hidden="true" className={cn('h-4', DASH.updated)} />
      <div className={DASH.main}>
        <div className={DASH.recent}>
          <RecentFrame>
            <RecentLoading count={rememberedRows() ?? 3} />
          </RecentFrame>
        </div>
        <StatusFrame badge={<StatusBadgeLoading />}>
          <StatusLoading />
        </StatusFrame>
      </div>
    </>
  );
}
