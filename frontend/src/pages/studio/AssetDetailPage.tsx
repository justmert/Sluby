import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import * as m from 'motion/react-m';
import { FileQuestion } from 'lucide-react';
import { ConflictError, type AccessTier, type VideoAsset } from '@sluby/sdk';
import { AccessControl } from '@/components/asset/AccessControl';
import { ActivityTimeline } from '@/components/asset/ActivityTimeline';
import { AssetDetailLoading } from '@/components/asset/AssetDetailLoading';
import { EmbedPanel } from '@/components/asset/EmbedPanel';
import { LazyAssetPlayer } from '@/components/asset/LazyAssetPlayer';
import { PlaybackIdsCard } from '@/components/asset/PlaybackIdsCard';
import { ProcessingCard } from '@/components/asset/ProcessingCard';
import { isInterrupted } from '@/components/asset/processing';
import { RenditionsTable } from '@/components/asset/RenditionsTable';
import { SiaStorageBreakdown } from '@/components/asset/SiaStorageBreakdown';
import { VideoActionsMenu } from '@/components/asset/VideoActionsMenu';
import { PageContainer } from '@/components/layout/PageContainer';
import { FadeSwap } from '@/components/motion';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { CopyButton } from '@/components/shared/CopyButton';
import { InlineEditField } from '@/components/shared/InlineEditField';
import { PageState } from '@/components/shared/PageState';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { copyWithToast } from '@/components/videos/video-actions';
import {
  useAssetRenditions,
  useAssetSiaInfo,
  useProcessingJob,
  useSendingHere,
  useUpdateVideo,
} from '@/hooks/asset-detail-queries';
import { errorStatus, useAssetById, useDeleteAssets, useForgetAsset } from '@/hooks/asset-queries';
import { usePlaybackIds } from '@/hooks/playback-id-queries';
import { ROUTES } from '@/lib/constants';
import { primaryEmbed } from '@/lib/embed';
import { errorText } from '@/lib/errors';
import {
  NO_VALUE,
  formatBytes,
  formatCount,
  formatDate,
  formatDuration,
  formatRelativeTime,
  formatResolution,
  plural,
} from '@/lib/formatters';
import { highlight, lateReveal } from '@/lib/motion';
import { toastError, toastSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 5000;

const TABS = ['share', 'playback', 'renditions', 'storage', 'activity'] as const;
type Tab = (typeof TABS)[number];

const CARD = 'rounded-xl border bg-card';

const pick = <T extends string>(value: string | null, from: readonly T[]): T | undefined =>
  from.includes(value as T) ? (value as T) : undefined;

/** The page's own boxes, so the content lands without moving anything (A11Y-37). */
function DetailSkeleton() {
  return (
    <div data-testid="asset-detail-skeleton">
      <h1 className="sr-only">Loading video</h1>
      <span className="sr-only" role="status">
        Loading video details
      </span>
      <AssetDetailLoading />
    </div>
  );
}

/** One row of the details card: the name on the left, the value right-aligned. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right tabular-nums">{children}</dd>
    </>
  );
}

/** A description that shows six lines and opens the rest on request (FLW-42). */
function DescriptionValue({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [clamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text, open]);
  if (!text) return <p className="text-muted-foreground">No description yet.</p>;
  return (
    <div>
      <p
        ref={ref}
        id="video-description"
        dir="auto"
        className={cn(
          'whitespace-pre-wrap text-secondary-foreground wrap-anywhere',
          !open && 'line-clamp-6',
        )}
      >
        {text}
      </p>
      {(clamped || open) && (
        <Button
          variant="link"
          size="sm"
          className="h-auto px-0"
          aria-expanded={open}
          aria-controls="video-description"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Show less' : 'Show more'}
        </Button>
      )}
    </div>
  );
}

export default function AssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const asset = useAssetById(id);
  const a = asset.data;
  const ready = a?.status === 'ready';
  const sendingHere = useSendingHere(id);
  const interrupted = a ? isInterrupted(a, sendingHere) : false;
  const job = useProcessingJob(
    id,
    a?.status,
    !!a && (a.status === 'processing' || a.status === 'failed' || ready),
  );
  const sia = useAssetSiaInfo(id, ready);
  const playbackIds = usePlaybackIds(id ?? '', ready);
  const renditions = useAssetRenditions(id, ready);
  const update = useUpdateVideo();
  const deleteAssets = useDeleteAssets();
  const forgetAsset = useForgetAsset();
  const [confirmDelete, setConfirmDelete] = useState<VideoAsset | null>(null);
  const deletedHere = useRef<string | null>(null);
  // the version an inline edit started from, sent as If-Match (FLW-06)
  const editBase = useRef<VideoAsset | null>(null);

  // a video that was ready by the time we watched it play gets the highlight once
  const [justReady, setJustReady] = useState(false);
  const lastStatus = useRef(a?.status);
  useEffect(() => {
    if (lastStatus.current && lastStatus.current !== 'ready' && a?.status === 'ready') {
      setJustReady(true);
    }
    lastStatus.current = a?.status;
  }, [a?.status]);

  // drop the deleted asset's queries once this page no longer watches them;
  // removing a watched query makes it fetch again and answer 404
  useEffect(
    () => () => {
      if (deletedHere.current) forgetAsset(deletedHere.current);
    },
    [forgetAsset],
  );

  // deleted in another tab or browser while open: say so, then show not found (FLW-44)
  const goneStatus = errorStatus(asset.error);
  const gone = !!a && asset.isError && (goneStatus === 404 || goneStatus === 400);
  useEffect(() => {
    if (!gone || !id || deletedHere.current === id) return;
    toastError('This video was deleted in another tab or browser');
    queryClient.removeQueries({ queryKey: ['assets', 'one', id], exact: true });
  }, [gone, id, queryClient]);

  if (!a || gone) {
    if (asset.isError || gone) {
      const status = errorStatus(asset.error);
      // a malformed id answers 400; both mean there is no such video (FLW-34)
      const notFound = status === 404 || status === 400;
      return (
        <PageContainer>
          {notFound ? (
            <PageState
              icon={FileQuestion}
              title="Video not found"
              description="Check the link. It may have been deleted, or it belongs to another account."
              actions={
                <Button asChild>
                  <Link to={ROUTES.VIDEOS}>Back to videos</Link>
                </Button>
              }
            />
          ) : (
            <PageState
              title="Could not load this video"
              error={asset.error}
              onRetry={() => void asset.refetch()}
              retrying={asset.isFetching}
              actions={
                <Button variant="outline" asChild>
                  <Link to={ROUTES.VIDEOS}>Back to videos</Link>
                </Button>
              }
            />
          )}
        </PageContainer>
      );
    }
    return (
      <PageContainer>
        <DetailSkeleton />
      </PageContainer>
    );
  }

  const tabs: Tab[] = ready ? [...TABS] : ['share', 'activity'];
  // the overview's "Get embed code" link used ?panel=share before the tabs merged
  const asked =
    pick(params.get('tab'), tabs) ?? (params.get('panel') === 'share' ? 'share' : undefined);
  const tab: Tab = asked ?? (ready ? 'share' : 'activity');
  const setTab = (value: string) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('panel');
        if (value === (ready ? 'share' : 'activity')) next.delete('tab');
        else next.set('tab', value);
        return next;
      },
      { replace: true },
    );

  const RELOADED =
    'Reloaded. Save again to keep what you typed, or press Escape to keep the latest.';
  const reload = (err: unknown, settle: (note: ReactNode) => void) => {
    const current = err instanceof ConflictError ? err.current : undefined;
    if (current) {
      queryClient.setQueryData(['assets', 'one', current.id], current);
      editBase.current = current;
      settle(RELOADED);
    } else {
      void asset.refetch().then((r) => {
        if (!r.data) return;
        editBase.current = r.data;
        settle(RELOADED);
      });
    }
  };

  const renderError = (
    err: unknown,
    { settle }: { settle: (note: ReactNode) => void },
  ): ReactNode =>
    err instanceof ConflictError && err.statusCode === 412 ? (
      <>
        This video was changed somewhere else. Reload it to see the latest, then edit again.{' '}
        <Button
          variant="link"
          size="sm"
          className="h-auto px-0"
          onClick={() => reload(err, settle)}
        >
          Reload
        </Button>
      </>
    ) : (
      errorText(err)
    );

  const save = async (patch: Partial<Pick<VideoAsset, 'title' | 'description'>>) => {
    await update.mutateAsync({ base: editBase.current ?? a, patch });
    editBase.current = null;
    toastSuccess('Changes saved');
  };

  const setAccess = async (accessTier: AccessTier) => {
    await update.mutateAsync({ base: a, patch: { accessTier } });
    toastSuccess(accessTier === 'private' ? 'The video is private now' : 'The video is public now');
  };

  const remove = async (video: VideoAsset) => {
    const failures = await deleteAssets.mutateAsync([video.id]);
    if (failures.length > 0) {
      // the failure is already the reader's sentence (useDeleteAssets)
      toastError(`Could not delete the video. ${failures[0].error}`);
      return;
    }
    deletedHere.current = video.id;
    toastSuccess('Video deleted');
    navigate(ROUTES.VIDEOS);
  };

  const onEditStart = () => {
    editBase.current = a;
  };

  const objectCount = sia.data?.totals.object_count;
  const qualities = renditions.data?.data.map((r) => r.name);

  const player = (
    <FadeSwap swapKey={ready ? 'player' : 'processing'}>
      {ready ? (
        <m.div
          className="rounded-xl"
          initial={false}
          animate={
            justReady
              ? { boxShadow: ['0 0 0 3px var(--ring)', '0 0 0 3px transparent'] }
              : undefined
          }
          transition={highlight}
          onAnimationComplete={() => setJustReady(false)}
        >
          <LazyAssetPlayer
            key={a.id}
            assetId={a.id}
            signed={a.accessTier === 'private'}
            title={a.title}
          />
        </m.div>
      ) : (
        <ProcessingCard
          asset={a}
          job={job.data}
          jobError={job.isError && errorStatus(job.error) !== 404}
          checking={job.isFetching}
          onCheckAgain={() => void job.refetch()}
          interrupted={interrupted}
          onDelete={() => setConfirmDelete(a)}
        />
      )}
    </FadeSwap>
  );

  return (
    <PageContainer className="flex flex-col gap-5 text-sm">
      {/* the title row: the title with its edit button, the status, and the actions */}
      <div className="flex flex-wrap items-center gap-3">
        <InlineEditField
          label="title"
          value={a.title}
          requiredMessage="Enter a title."
          maxLength={TITLE_MAX}
          draftKey={`video-title:${a.id}`}
          onEditStart={onEditStart}
          renderError={renderError}
          onSave={(title) => save({ title })}
          className="max-w-full items-center [&_[data-slot=button]]:text-muted-foreground"
          display={(shown) => (
            <h1 dir="auto" className="line-clamp-3 font-heading text-title wrap-anywhere">
              {shown}
            </h1>
          )}
          whileEditing={(shown) => <h1 dir="auto">{shown}</h1>}
        />
        <StatusBadge kind="asset" status={interrupted ? 'interrupted' : a.status} live />
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            disabled={!ready}
            title={ready ? undefined : 'Available once the video is ready'}
            onClick={() => void copyWithToast(primaryEmbed(a).code, 'Embed code copied')}
          >
            Copy embed code
          </Button>
          <VideoActionsMenu
            asset={a}
            onDelete={() => setConfirmDelete(a)}
            deleting={deleteAssets.isPending}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 flex-[999_1_520px] flex-col gap-4">
          {player}

          <Tabs value={tab} onValueChange={setTab} className="gap-4">
            <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              <TabsList
                variant="line"
                aria-label="Video sections"
                className="w-full min-w-max justify-start"
                // a tab half outside the strip scrolls into view when it takes focus
                onFocus={(e) => e.target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })}
              >
                <TabsTrigger value="share">Share</TabsTrigger>
                {ready && (
                  <>
                    <TabsTrigger value="playback">
                      Playback IDs
                      {playbackIds.data && (
                        <span className="text-muted-foreground tabular-nums">
                          {playbackIds.data.length}
                        </span>
                      )}
                    </TabsTrigger>
                    <TabsTrigger value="renditions">
                      Renditions
                      {renditions.data && (
                        <span className="text-muted-foreground tabular-nums">
                          {renditions.data.data.length}
                        </span>
                      )}
                    </TabsTrigger>
                    <TabsTrigger value="storage">Storage</TabsTrigger>
                  </>
                )}
                <TabsTrigger value="activity">Activity</TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="share">
              <section aria-label="Share" className={cn(CARD, 'p-5')}>
                <EmbedPanel asset={a} playbackIds={playbackIds.data} />
              </section>
            </TabsContent>
            {ready && (
              <>
                <TabsContent value="playback">
                  <PlaybackIdsCard asset={a} />
                </TabsContent>
                <TabsContent value="renditions">
                  <RenditionsTable assetId={a.id} />
                </TabsContent>
                <TabsContent value="storage">
                  <FadeSwap swapKey={sia.isLoading ? 'loading' : 'ready'}>
                    <SiaStorageBreakdown
                      info={sia.data}
                      isLoading={sia.isLoading}
                      error={sia.error}
                      onRetry={sia.refetch}
                      retrying={sia.isFetching}
                    />
                  </FadeSwap>
                </TabsContent>
              </>
            )}
            <TabsContent value="activity">
              <ActivityTimeline
                job={job.data}
                isLoading={job.isLoading}
                error={job.error}
                notStarted={a.status === 'created' || a.status === 'uploading'}
                onRetry={job.refetch}
                retrying={job.isFetching}
              />
            </TabsContent>
          </Tabs>
        </div>

        <aside
          aria-label="About this video"
          className="flex min-w-0 flex-[1_1_300px] flex-col gap-4"
        >
          <section aria-labelledby="details-heading" className={cn(CARD, 'px-5 py-4.5')}>
            <h2 id="details-heading" className="mb-3 font-heading text-heading">
              Details
            </h2>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2.5">
              <Fact label="Access">
                <AccessControl value={a.accessTier} onChange={setAccess} />
              </Fact>
              <Fact label="Length">{a.durationMs ? formatDuration(a.durationMs) : NO_VALUE}</Fact>
              <Fact label="Quality">
                {!ready ? (
                  NO_VALUE
                ) : qualities ? (
                  qualities.length > 0 ? (
                    qualities.join(', ')
                  ) : a.resolution ? (
                    formatResolution(a.resolution)
                  ) : (
                    NO_VALUE
                  )
                ) : renditions.isError ? (
                  NO_VALUE
                ) : (
                  <Skeleton className={cn('ml-auto h-3.5 w-28', lateReveal)} />
                )}
              </Fact>
              <Fact label="Size">
                {a.totalStorageBytes > 0 ? formatBytes(a.totalStorageBytes) : NO_VALUE}
              </Fact>
              <Fact label="Plays">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      tabIndex={0}
                      className="rounded-sm underline decoration-dotted underline-offset-4"
                    >
                      {formatCount(a.playCount)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    Counted each time a player loads the video. Studio previews do not count.
                  </TooltipContent>
                </Tooltip>
              </Fact>
              <Fact label="Last played">
                {a.lastPlayedAt ? (
                  <time dateTime={a.lastPlayedAt} title={formatDate(a.lastPlayedAt)}>
                    {formatRelativeTime(a.lastPlayedAt)}
                  </time>
                ) : (
                  'Never'
                )}
              </Fact>
              <Fact label="Uploaded">
                <time dateTime={a.createdAt}>{formatDate(a.createdAt)}</time>
              </Fact>
              <Fact label="Video ID">
                <span className="inline-flex max-w-full items-center gap-2">
                  <span className="truncate font-mono text-xs" title={a.id}>
                    {`${a.id.slice(0, 8)}…${a.id.slice(-4)}`}
                  </span>
                  <CopyButton
                    value={a.id}
                    label="Copy video ID"
                    withText
                    variant="outline"
                    className="h-6 shrink-0 px-1.5 text-xs [&_svg]:hidden"
                  />
                </span>
              </Fact>
            </dl>
          </section>

          <section
            aria-labelledby="description-heading"
            className={cn(
              CARD,
              // the field's edit button moves up into the heading row, as the board's "Edit"
              'relative flex flex-col gap-2 px-5 py-4.5 [&_[data-slot=inline-edit]>button]:absolute [&_[data-slot=inline-edit]>button]:top-3.5 [&_[data-slot=inline-edit]>button]:right-4',
            )}
          >
            <h2 id="description-heading" className="font-heading text-heading">
              Description
            </h2>
            <InlineEditField
              label="description"
              value={a.description}
              multiline
              maxLength={DESCRIPTION_MAX}
              counterFrom={4500}
              placeholder="Add a description"
              draftKey={`video-description:${a.id}`}
              onEditStart={onEditStart}
              renderError={renderError}
              onSave={(description) => save({ description })}
              className="[&>button]:w-auto [&>button]:px-2.5 [&>button>svg]:hidden [&>button]:after:content-['Edit']"
              display={(shown) => <DescriptionValue text={shown} />}
            />
          </section>

          <section
            aria-labelledby="delete-heading"
            className={cn(CARD, 'flex flex-col gap-2 px-5 py-4.5')}
          >
            <h2 id="delete-heading" className="font-heading text-heading">
              Delete video
            </h2>
            <p className="text-muted-foreground">Removes it from Sia and stops every embed.</p>
            <Button
              variant="destructive-outline"
              className="self-start"
              disabled={deleteAssets.isPending}
              onClick={() => setConfirmDelete(a)}
            >
              Delete video
            </Button>
          </section>
        </aside>
      </div>

      <ConfirmDialog
        item={confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title={(v) => `Delete “${v.title}”?`}
        description={(v) =>
          v.status === 'ready' ? (
            <>
              It is removed from your library now and{' '}
              {objectCount === undefined
                ? 'its files are'
                : objectCount === 1
                  ? 'its 1 file is'
                  : `its ${plural(objectCount, 'file')} are`}{' '}
              removed from Sia in the background. Every embed stops working. This cannot be undone.
            </>
          ) : (
            <>It is removed from your library now. This cannot be undone.</>
          )
        }
        confirmLabel="Delete video"
        pendingLabel="Deleting…"
        errorTitle="Could not delete the video"
        onConfirm={remove}
      />
    </PageContainer>
  );
}
