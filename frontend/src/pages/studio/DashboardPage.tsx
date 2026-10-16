import { useEffect, useState } from 'react';
import { PageContainer, PageHeader } from '@/components/layout/PageContainer';
import { DashboardLoading, OverviewStats } from '@/components/dashboard/dashboard-parts';
import {
  DASH,
  RECENT,
  rememberRows,
  rememberedRows,
} from '@/components/dashboard/dashboard-layout';
import { routeSkeletonWasVisible } from '@/components/dashboard/live';
import { UpdatedAgo } from '@/components/dashboard/UpdatedAgo';
import { AnimatedItem, AnimatedList, Collapse } from '@/components/motion';
import { attentionItems, attentionTotal } from '@/components/overview/attention';
import { GetStarted } from '@/components/overview/GetStarted';
import {
  busyVideo,
  doneCount,
  REQUIRED_STEPS,
  stepStates,
  useGetStartedHidden,
} from '@/components/overview/get-started';
import { NeedsAttention } from '@/components/overview/NeedsAttention';
import { RecentVideos } from '@/components/overview/RecentVideos';
import { StatusCard } from '@/components/overview/StatusCard';
import { InlineError } from '@/components/shared/InlineError';
import { useStaleUploadCount } from '@/hooks/asset-queries';
import { useApiKeys } from '@/hooks/useApiKeys';
import {
  isStalled,
  useFailedVideos,
  useFirstReadyVideo,
  useLatestAssets,
  useSendingIds,
  useWaitingVideos,
} from '@/hooks/useLatestAssets';
import { useAssetStats, useReconciliation } from '@/hooks/useStats';
import { useSystemStatus } from '@/hooks/useSystemStatus';
import { useUsage } from '@/hooks/useUsage';
import { useWebhooks } from '@/hooks/useWebhooks';
import { useSession } from '@/lib/session';
import { useUploadSheet } from '@/lib/upload-sheet';
import { UploadVideoButton } from '@/components/layout/page-actions';
import { PAGE_HEADS } from '@/components/layout/page-heads';

// enough of the newest videos that six remain once abandoned placeholders are left out
const RECENT_FETCH = 20;

// how long the page holds its first draw for the answers that decide its
// layout (checklist, needs attention). the skeleton already says the page is
// loading, so waiting for them is calmer than drawing early and letting a
// late Needs attention push the totals down. past this, a slow server gets
// what has loaded, and a later answer fills its card in
const FIRST_DRAW_WAIT_MS = 10_000;

// a finished checklist stays on screen this long, so the last tick is seen
const DONE_LINGER_MS = 1_500;

function useWaited(ms: number, skip: boolean): boolean {
  const [waited, setWaited] = useState(skip);
  useEffect(() => {
    if (waited) return;
    const id = window.setTimeout(() => setWaited(true), ms);
    return () => window.clearTimeout(id);
  }, [ms, waited]);
  return waited;
}

export default function DashboardPage() {
  const session = useSession();
  const { operator } = session;
  const sheet = useUploadSheet();

  const stats = useAssetStats();
  const system = useSystemStatus({ poll: true });
  const usage = useUsage();
  const keys = useApiKeys();
  const webhooks = useWebhooks();
  const run = useReconciliation();
  const failed = useFailedVideos();
  const waiting = useWaitingVideos();
  // the same walk the library uses for "uploads never started", so the counts agree
  const staleCreated = useStaleUploadCount();
  const latest = useLatestAssets(RECENT_FETCH);
  const sending = useSendingIds();

  const s = stats.data;
  const first = [
    stats,
    system,
    usage,
    keys,
    webhooks,
    run,
    failed,
    waiting.created,
    waiting.uploading,
    latest,
  ];
  const settled = first.every((q) => !q.isPending);
  // back on a page whose data is cached, everything is simply there
  const [cached] = useState(settled);
  const waited = useWaited(FIRST_DRAW_WAIT_MS, cached);
  const ready = settled || waited;
  // taking over from the route skeleton: keep its placeholders on screen
  const [instant] = useState(routeSkeletonWasVisible);

  // the checklist
  const { hidden, hide } = useGetStartedHidden(session.id);
  const steps = stepStates({
    operator,
    status: system.data,
    stats: s,
    usage: usage.data,
    activeKeys: keys.data?.data.filter((k) => k.isActive).length,
    webhooks: webhooks.data?.data.length,
    videos: latest.data?.data,
  });
  const complete = doneCount(steps) === REQUIRED_STEPS;
  // a step whose data failed to load is unknown, not undone: the card would
  // tell an account with keys and videos that it has none
  const known = [stats, system, usage, keys, webhooks].every((q) => q.data !== undefined);
  const [shownOpen, setShownOpen] = useState(false);
  if (ready && known && !hidden && !complete && !shownOpen) setShownOpen(true);
  useEffect(() => {
    if (!ready || !known || hidden || !complete) return;
    // finished before it was ever drawn: never draw it
    if (!shownOpen) return hide('done');
    const id = window.setTimeout(() => hide('done'), DONE_LINGER_MS);
    return () => window.clearTimeout(id);
  }, [ready, known, hidden, complete, shownOpen, hide]);
  const showChecklist = ready && !hidden && (shownOpen || (known && !complete));
  const firstReady = useFirstReadyVideo(showChecklist && (s?.by_status.ready ?? 0) > 0);

  // recent videos, leaving out uploads whose file never came (FLW-31)
  const recent = latest.data?.data.filter((v) => !isStalled(v, sending)).slice(0, RECENT);
  const stalledCount = latest.data?.data.filter((v) => isStalled(v, sending)).length ?? 0;
  const shown = recent?.length;
  useEffect(() => {
    if (shown) rememberRows(shown);
  }, [shown]);
  const [placeholders] = useState(() =>
    s !== undefined ? Math.max(1, Math.min(RECENT, s.total)) : (rememberedRows() ?? 3),
  );

  // needs attention
  const stalled = [...(waiting.created.data?.data ?? []), ...(waiting.uploading.data?.data ?? [])]
    .filter((v) => isStalled(v, sending))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const attentionInput = {
    status: system.data,
    run: run.data,
    failed: failed.data?.data,
    failedTotal: failed.data?.total,
    stalled,
    stalledTotal:
      staleCreated.data === undefined
        ? undefined
        : staleCreated.data + stalled.filter((v) => v.status === 'uploading').length,
    webhooks: webhooks.data?.data,
  };
  const attention = attentionItems(attentionInput);
  const attentionCount = attentionTotal(attentionInput, attention);

  // cards stagger in when the page had to wait for its first numbers
  const stagger = !cached;

  return (
    <PageContainer>
      <PageHeader
        {...PAGE_HEADS.overview}
        primaryAction={<UploadVideoButton onClick={() => sheet.open()} />}
      />

      {!ready ? (
        <div data-instant-skeletons={instant || undefined}>
          <DashboardLoading operator={operator} />
        </div>
      ) : (
        <div>
          <Collapse open={showChecklist}>
            <div className="pb-4">
              <GetStarted
                steps={steps}
                operator={operator}
                status={system.data}
                busy={busyVideo(latest.data?.data)}
                firstReady={firstReady.data}
                onDismiss={() => {
                  hide('dismissed');
                  // the button is gone; keep keyboard users on the page
                  document.getElementById('main-content')?.focus();
                }}
              />
            </div>
          </Collapse>
          <Collapse open={attention.length > 0}>
            <div className="pb-4">
              <NeedsAttention
                items={attention}
                total={attentionCount}
                operator={operator}
                stagger={stagger}
              />
            </div>
          </Collapse>

          <InlineError
            title={s ? 'Totals are out of date' : 'Could not load your totals'}
            error={stats.error}
            note={s ? 'Showing the last figures that loaded.' : undefined}
            onRetry={() => void stats.refetch()}
            retrying={stats.isFetching}
            className="mb-4"
          />

          <OverviewStats
            s={s}
            usage={usage.data}
            failed={stats.isError && !s}
            usageFailed={usage.isError && !usage.data}
            stagger={stagger}
          />
          <UpdatedAgo
            className={DASH.updated}
            updatedAt={stats.dataUpdatedAt}
            data={s}
            stale={stats.isError}
            label="Totals updated"
          />

          <AnimatedList as="div" initial={stagger ? 'hidden' : false} className={DASH.main}>
            <AnimatedItem as="div" key="recent" layout={false} className={DASH.recent}>
              <RecentVideos
                videos={recent}
                error={latest.error}
                onRetry={() => void latest.refetch()}
                retrying={latest.isFetching}
                placeholders={placeholders}
                stalled={stalledCount}
              />
            </AnimatedItem>
            <AnimatedItem as="div" key="status" layout={false}>
              <StatusCard
                status={system.data}
                error={system.error}
                onRetry={() => void system.refetch()}
                retrying={system.isFetching}
                run={run.data}
                runFailed={run.isError && run.data === undefined}
                operator={operator}
              />
            </AnimatedItem>
          </AnimatedList>
        </div>
      )}
    </PageContainer>
  );
}
