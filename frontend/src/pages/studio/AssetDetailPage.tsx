import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import * as m from 'motion/react-m';
import { FileQuestion, Share2 } from 'lucide-react';
import { ConflictError, type AccessTier, type VideoAsset } from '@sluby/sdk';
import { AccessControl } from '@/components/asset/AccessControl';
import { ActivityTimeline } from '@/components/asset/ActivityTimeline';
import { AssetPlayer } from '@/components/asset/AssetPlayer';
import { EmbedPanel } from '@/components/asset/EmbedPanel';
import { PlaybackIdsCard } from '@/components/asset/PlaybackIdsCard';
import { ProcessingCard } from '@/components/asset/ProcessingCard';
import { isInterrupted } from '@/components/asset/processing';
import { RenditionsTable } from '@/components/asset/RenditionsTable';
import { SiaStorageBreakdown } from '@/components/asset/SiaStorageBreakdown';
import { VideoActionsMenu } from '@/components/asset/VideoActionsMenu';
import { PageContainer } from '@/components/layout/PageContainer';
import { FadeSwap } from '@/components/motion';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { CopyField } from '@/components/shared/CopyField';
import { DescriptionItem, DescriptionList } from '@/components/shared/DescriptionList';
import { InlineEditField } from '@/components/shared/InlineEditField';
import { ObjectIdBadge } from '@/components/shared/ObjectIdBadge';
import { PageHeader } from '@/components/shared/PageHeader';
import { PageState } from '@/components/shared/PageState';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { AssetDetailLoading } from '@/components/asset/AssetDetailLoading';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  useAssetRenditions,
  useAssetSiaInfo,
  useProcessingJob,
  useSendingHere,
  useUpdateVideo,
} from '@/hooks/asset-detail-queries';
import { errorStatus, useAssetById, useDeleteAssets, useForgetAsset } from '@/hooks/asset-queries';
import { usePlaybackIds } from '@/hooks/playback-id-queries';
import { useMediaQuery } from '@/hooks/use-mobile';
import { ROUTES } from '@/lib/constants';
import { errorText } from '@/lib/errors';
import {
  formatBytes,
  formatDate,
  formatDuration,
  formatRelativeTime,
  formatResolution,
  plural,
} from '@/lib/formatters';
import { highlight } from '@/lib/motion';
import { toastError, toastSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 5000;

const LOWER_TABS = ['playback', 'storage', 'renditions', 'activity'] as const;
type LowerTab = (typeof LOWER_TABS)[number];
const SIDE_TABS = ['share', 'details'] as const;
type SideTab = (typeof SIDE_TABS)[number];

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

function MetaRow({ asset, interrupted }: { asset: VideoAsset; interrupted: boolean }) {
  const parts: ReactNode[] = [];
  if (asset.durationMs) parts.push(formatDuration(asset.durationMs));
  if (asset.resolution) parts.push(formatResolution(asset.resolution));
  if (asset.status === 'ready' && asset.totalStorageBytes > 0) {
    parts.push(`${formatBytes(asset.totalStorageBytes)} on Sia`);
  }
  if (asset.status === 'ready') {
    parts.push(
      <Tooltip key="plays">
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className="rounded-sm underline decoration-dotted underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring"
          >
            {plural(asset.playCount, 'play')}
          </span>
        </TooltipTrigger>
        <TooltipContent>Counted each time a player loads the video</TooltipContent>
      </Tooltip>,
    );
  }
  parts.push(`Created ${formatRelativeTime(asset.createdAt)}`);
  const items: ReactNode[] = [
    <StatusBadge
      key="status"
      kind="asset"
      status={interrupted ? 'interrupted' : asset.status}
      busy="spinner"
      live
    />,
    ...parts,
  ];
  // the dot ends each item, so a wrapped line never starts with one
  return (
    <>
      {items.map((item, i) => (
        <span key={i} className="inline-flex items-center gap-2">
          {item}
          {i < items.length - 1 && <span aria-hidden="true">·</span>}
        </span>
      ))}
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
  if (!text) return <p className="text-muted-foreground">No description</p>;
  return (
    <div>
      <p
        ref={ref}
        id="video-description"
        dir="auto"
        className={cn('whitespace-pre-wrap wrap-anywhere', !open && 'line-clamp-6')}
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

interface EditProps {
  asset: VideoAsset;
  /** saves one field, based on the version the edit started from */
  save: (patch: Partial<Pick<VideoAsset, 'title' | 'description'>>) => Promise<unknown>;
  onEditStart: () => void;
  renderError: (err: unknown) => ReactNode;
}

function DetailsPanel({ asset, save, onEditStart, renderError }: EditProps) {
  return (
    <div className="flex flex-col gap-4">
      <DescriptionList>
        <DescriptionItem label="Video ID">
          <CopyField label="video ID" value={asset.id} truncate={8} />
        </DescriptionItem>
        <DescriptionItem label="Main playlist file">
          {asset.manifestObjectId && (
            <ObjectIdBadge
              value={asset.manifestObjectId}
              truncate={6}
              copyLabel="Copy main playlist file ID"
            />
          )}
        </DescriptionItem>
        <DescriptionItem label="Source resolution">
          {asset.resolution && formatResolution(asset.resolution)}
        </DescriptionItem>
        <DescriptionItem label="Created">{formatDate(asset.createdAt)}</DescriptionItem>
        <DescriptionItem label="Updated">{formatDate(asset.updatedAt)}</DescriptionItem>
      </DescriptionList>
      <div className="text-sm">
        <h3 className="mb-1 font-sans text-sm text-muted-foreground">Description</h3>
        <InlineEditField
          label="description"
          value={asset.description}
          multiline
          maxLength={DESCRIPTION_MAX}
          counterFrom={4500}
          placeholder="Add a description"
          onEditStart={onEditStart}
          renderError={renderError}
          onSave={(description) => save({ description })}
          display={(shown) => <DescriptionValue text={shown} />}
        />
      </div>
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
  const wide = useMediaQuery('(min-width: 640px)');
  const [shareOpen, setShareOpen] = useState(false);
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

  const side: SideTab = pick(params.get('panel'), SIDE_TABS) ?? (ready ? 'share' : 'details');
  const lower: LowerTab = ready ? (pick(params.get('tab'), LOWER_TABS) ?? 'playback') : 'activity';
  const setParam = (name: string, value: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === null) next.delete(name);
        else next.set(name, value);
        return next;
      },
      { replace: true },
    );

  const reload = (err: unknown) => {
    const current = err instanceof ConflictError ? err.current : undefined;
    if (current) {
      queryClient.setQueryData(['assets', 'one', current.id], current);
      editBase.current = current;
    } else {
      void asset.refetch().then((r) => {
        if (r.data) editBase.current = r.data;
      });
    }
  };

  const renderError = (err: unknown): ReactNode =>
    err instanceof ConflictError && err.statusCode === 412 ? (
      <>
        This video was changed somewhere else. Reload it to see the latest, then edit again.{' '}
        <Button variant="link" size="sm" className="h-auto px-0" onClick={() => reload(err)}>
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

  const editProps = {
    asset: a,
    save,
    onEditStart: () => {
      editBase.current = a;
    },
    renderError,
  };

  const objectCount = sia.data?.totals.object_count;
  const share = <EmbedPanel asset={a} playbackIds={playbackIds.data} />;

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
          <AssetPlayer
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
    <PageContainer>
      <PageHeader
        title={a.title}
        heading={
          <InlineEditField
            label="title"
            value={a.title}
            requiredMessage="Enter a title."
            maxLength={TITLE_MAX}
            onEditStart={editProps.onEditStart}
            renderError={renderError}
            onSave={(title) => save({ title })}
            display={(shown) => (
              <h1 dir="auto" className="line-clamp-3 font-heading text-title wrap-anywhere">
                {shown}
              </h1>
            )}
            whileEditing={(shown) => <h1 dir="auto">{shown}</h1>}
          />
        }
        meta={<MetaRow asset={a} interrupted={interrupted} />}
        secondaryActions={
          <>
            <AccessControl value={a.accessTier} onChange={setAccess} />
            <VideoActionsMenu
              asset={a}
              onDelete={() => setConfirmDelete(a)}
              deleting={deleteAssets.isPending}
            />
          </>
        }
      />

      <div className="grid items-start gap-6 @5xl/page:grid-cols-[minmax(0,1fr)_24rem] @7xl/page:grid-cols-[minmax(0,1fr)_28rem]">
        <div className="flex min-w-0 flex-col gap-3">
          {player}
          {!wide && ready && (
            <Button variant="outline" className="self-start" onClick={() => setShareOpen(true)}>
              <Share2 />
              Share
            </Button>
          )}
        </div>

        {wide ? (
          <Tabs
            value={side}
            onValueChange={(v) => setParam('panel', v)}
            className="min-w-0 rounded-xl border bg-card p-4 shadow-xs dark:shadow-none"
          >
            <TabsList aria-label="Share and details">
              <TabsTrigger value="share">Share</TabsTrigger>
              <TabsTrigger value="details">Details</TabsTrigger>
            </TabsList>
            <TabsContent value="share" className="mt-2">
              <h2 className="sr-only">Share</h2>
              {share}
            </TabsContent>
            <TabsContent value="details" className="mt-2">
              <h2 className="sr-only">Details</h2>
              <DetailsPanel {...editProps} />
            </TabsContent>
          </Tabs>
        ) : (
          <section
            aria-labelledby="details-heading"
            className="rounded-xl border bg-card p-4 shadow-xs dark:shadow-none"
          >
            <h2 id="details-heading" className="mb-2 font-heading text-heading">
              Details
            </h2>
            <DetailsPanel {...editProps} />
          </section>
        )}
      </div>

      <Tabs
        value={lower}
        onValueChange={(v) => setParam('tab', v === 'playback' ? null : v)}
        className="mt-10"
      >
        <div className="-mx-4 scroll-px-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList
            aria-label="Video sections"
            // a tab half outside the strip scrolls into view when it takes focus
            onFocus={(e) => e.target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })}
          >
            {ready && (
              <>
                <TabsTrigger value="playback">
                  Playback IDs
                  {playbackIds.data && (
                    <span className="text-muted-foreground tabular-nums">
                      ({playbackIds.data.length})
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="storage">Storage on Sia</TabsTrigger>
                <TabsTrigger value="renditions">
                  Renditions
                  {renditions.data && (
                    <span className="text-muted-foreground tabular-nums">
                      ({renditions.data.data.length})
                    </span>
                  )}
                </TabsTrigger>
              </>
            )}
            <TabsTrigger value="activity">Activity</TabsTrigger>
          </TabsList>
        </div>
        {ready && (
          <>
            <TabsContent value="playback" className="mt-4">
              <PlaybackIdsCard asset={a} />
            </TabsContent>
            <TabsContent value="storage" className="mt-4">
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
            <TabsContent value="renditions" className="mt-4">
              <RenditionsTable assetId={a.id} />
            </TabsContent>
          </>
        )}
        <TabsContent value="activity" className="mt-4">
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

      {!wide && (
        <Sheet open={shareOpen && ready} onOpenChange={setShareOpen}>
          <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Share</SheetTitle>
              <SheetDescription>Embed code for this video</SheetDescription>
            </SheetHeader>
            <div className="px-4 pb-6">{share}</div>
          </SheetContent>
        </Sheet>
      )}

      <ConfirmDialog
        item={confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete this video?"
        description={(v) =>
          v.status === 'ready' ? (
            <>
              <span dir="auto">“{v.title}”</span> is removed from your library now and{' '}
              {objectCount === undefined
                ? 'its files are'
                : objectCount === 1
                  ? 'its 1 file is'
                  : `its ${plural(objectCount, 'file')} are`}{' '}
              removed from Sia in the background. This cannot be undone.
            </>
          ) : (
            <>
              <span dir="auto">“{v.title}”</span> is removed from your library now. This cannot be
              undone.
            </>
          )
        }
        confirmLabel="Delete"
        pendingLabel="Deleting…"
        errorTitle="Could not delete the video"
        onConfirm={remove}
      />
    </PageContainer>
  );
}
