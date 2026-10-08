import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  FileQuestion,
  Lock,
  Pencil,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import type { AccessTier, RetryStage, VideoAsset } from '@sluby/sdk';
import { PageContainer } from '@/components/layout/PageContainer';
import { AssetPlayer } from '@/components/asset/AssetPlayer';
import { AssetStatusBadge } from '@/components/asset/AssetStatusBadge';
import { PlaybackIdsCard } from '@/components/asset/PlaybackIdsCard';
import { ProcessingSteps } from '@/components/asset/ProcessingSteps';
import { failureSummary, jobSummary } from '@/components/asset/processing';
import { SiaStorageBreakdown } from '@/components/asset/SiaStorageBreakdown';
import { Collapse, FadeSwap } from '@/components/motion';
import { ObjectIdBadge } from '@/components/shared/ObjectIdBadge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ResponsiveCell, ResponsiveTable } from '@/components/ui/responsive-table';
import { Spinner } from '@/components/ui/spinner';
import { TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  useAssetRenditions,
  useAssetSiaInfo,
  useProcessingJob,
} from '@/hooks/asset-detail-queries';
import {
  useAssetById,
  useDeleteAssets,
  useForgetAsset,
  useRetryProcessing,
  useUpdateAssetMeta,
} from '@/hooks/asset-queries';
import { useFrozen } from '@/hooks/useFrozen';
import { formatBitrate, formatBytes, formatDate, formatDuration } from '@/lib/formatters';
import { cn } from '@/lib/utils';

interface Draft {
  title: string;
  description: string;
  accessTier: AccessTier;
}

/**
 * Edits title, description and access. Saving closes it at once: the page
 * shows the new values while the save runs and puts the old ones back if it
 * fails, with a toast that reopens the form on what was typed.
 */
function EditDialog({
  draft,
  open,
  onOpenChange,
  onSave,
}: {
  draft: Draft;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (draft: Draft) => void;
}) {
  const [title, setTitle] = useState(draft.title);
  const [description, setDescription] = useState(draft.description);
  const [accessTier, setAccessTier] = useState<AccessTier>(draft.accessTier);
  const [titleError, setTitleError] = useState<string | null>(null);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setTitleError('Enter a title.');
      return;
    }
    onSave({ title: trimmed, description: description.trim(), accessTier });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={save} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Edit asset</DialogTitle>
            <DialogDescription>
              Changes apply to the API at once and to every player within a minute. Viewers playing
              direct from Sia keep the links they already have until those expire.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={titleError ? true : undefined}>
              <FieldLabel htmlFor="edit-title">Title</FieldLabel>
              <Input
                id="edit-title"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setTitleError(null);
                }}
                required
                maxLength={200}
                aria-invalid={titleError ? true : undefined}
                aria-describedby={titleError ? 'edit-title-error' : undefined}
              />
              {titleError && <FieldError id="edit-title-error">{titleError}</FieldError>}
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-description">Description</FieldLabel>
              <Textarea
                id="edit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="edit-access">Access</FieldLabel>
              <Select value={accessTier} onValueChange={(v) => setAccessTier(v as AccessTier)}>
                <SelectTrigger id="edit-access" className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Public</SelectItem>
                  <SelectItem value="private">Private</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const RETRY_STAGE_LABEL: Record<RetryStage, string> = {
  transcode: 'the transcode',
  'upload-segments': 'the Sia upload',
};

function ProcessingCard({ asset }: { asset: VideoAsset }) {
  const job = useProcessingJob(asset.id, asset.status, true);
  const retryProcessing = useRetryProcessing();
  const [showDetails, setShowDetails] = useState(false);
  // the job is the fresher signal: it moves first when a retry starts
  const failed = job.data ? job.data.status === 'failed' : asset.status === 'failed';

  const retry = async () => {
    try {
      const { stage } = await retryProcessing.mutateAsync(asset.id);
      toast.success(`Processing restarted from ${RETRY_STAGE_LABEL[stage]}`);
    } catch (err) {
      toast.error(`Retry failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{failed ? 'Processing failed' : 'Processing'}</CardTitle>
        <CardDescription>
          {failed
            ? failureSummary(job.data)
            : job.data
              ? jobSummary(job.data)
              : asset.status === 'uploading' || asset.status === 'created'
                ? 'Waiting for the upload to finish'
                : 'Waiting for the queue'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {job.data && !failed && (
          <Progress value={job.data.progressPercent} aria-label="Processing progress" />
        )}
        <ProcessingSteps job={job.data} failed={failed} />
        {failed && (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>The pipeline stopped</AlertTitle>
            <AlertDescription>
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-sm text-current underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                aria-expanded={showDetails}
                aria-controls="failure-details"
                onClick={() => setShowDetails((v) => !v)}
              >
                Details
                <ChevronDown
                  className={cn(
                    'size-3.5 transition-transform duration-200',
                    showDetails && 'rotate-180',
                  )}
                  aria-hidden="true"
                />
              </button>
              <Collapse open={showDetails} id="failure-details" className="pt-2">
                <p className="font-mono text-xs break-words">
                  {job.data?.errorMessage ?? 'No error message was recorded.'}
                </p>
              </Collapse>
            </AlertDescription>
          </Alert>
        )}
        {job.data && job.data.logs.length > 0 && (
          <div className="max-h-48 overflow-y-auto rounded-lg bg-muted/50 p-3 font-mono text-xs">
            {job.data.logs.map((line, i) => (
              <div key={i} className="flex gap-3">
                <span className="shrink-0 text-muted-foreground">
                  {new Date(line.timestamp).toLocaleTimeString()}
                </span>
                <span className="shrink-0 text-primary">{line.stage}</span>
                <span className="min-w-0 break-words">{line.message}</span>
              </div>
            ))}
          </div>
        )}
        {failed && (
          <Button
            className="self-start"
            onClick={() => void retry()}
            disabled={retryProcessing.isPending}
          >
            {retryProcessing.isPending ? <Spinner aria-hidden="true" /> : <RotateCcw />}
            Retry processing
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function RenditionsCard({ assetId }: { assetId: string }) {
  const renditions = useAssetRenditions(assetId, true);
  const rows = renditions.data?.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Renditions</CardTitle>
        <CardDescription>
          The adaptive ladder the transcoder produced, capped at the source resolution
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {renditions.isLoading ? (
          <div className="flex flex-col gap-2 px-4">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : renditions.isError ? (
          <p className="px-4 text-sm text-destructive">{renditions.error.message}</p>
        ) : rows.length === 0 ? (
          <p className="px-4 text-sm text-muted-foreground">
            No rendition records for this asset. Assets stored before renditions were recorded only
            list their objects in the Sia breakdown.
          </p>
        ) : (
          <ResponsiveTable className="max-sm:px-4">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Rendition</TableHead>
                <TableHead>Resolution</TableHead>
                <TableHead className="text-right">Video bitrate</TableHead>
                <TableHead className="text-right">Segments</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead>Playlist object</TableHead>
                <TableHead className="pr-4">Media object</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.name}>
                  <ResponsiveCell cell="primary" className="pl-4 font-medium">
                    {r.name}
                  </ResponsiveCell>
                  <ResponsiveCell label="Resolution" className="tabular-nums">
                    {r.width && r.height ? `${r.width}x${r.height}` : '-'}
                  </ResponsiveCell>
                  <ResponsiveCell label="Video bitrate" className="text-right tabular-nums">
                    {r.video_bitrate_kbps ? formatBitrate(r.video_bitrate_kbps * 1000) : '-'}
                  </ResponsiveCell>
                  <ResponsiveCell label="Segments" className="text-right tabular-nums">
                    {r.segment_count}
                  </ResponsiveCell>
                  <ResponsiveCell label="Size" className="text-right tabular-nums">
                    {formatBytes(r.byte_size)}
                  </ResponsiveCell>
                  <ResponsiveCell label="Playlist object">
                    <ObjectIdBadge value={r.playlist_object_id} truncate={6} />
                  </ResponsiveCell>
                  <ResponsiveCell label="Media object" className="pr-4">
                    <ObjectIdBadge value={r.data_object_id} truncate={6} />
                  </ResponsiveCell>
                </TableRow>
              ))}
            </TableBody>
          </ResponsiveTable>
        )}
      </CardContent>
    </Card>
  );
}

function DetailsCard({ asset }: { asset: VideoAsset }) {
  const rows: Array<[string, React.ReactNode]> = [
    ['Asset ID', <ObjectIdBadge key="id" value={asset.id} truncate={8} />],
    ['Status', <AssetStatusBadge key="s" status={asset.status} />],
    ['Access', asset.accessTier === 'private' ? 'Private (signed URLs)' : 'Public'],
    ['Duration', asset.durationMs ? formatDuration(asset.durationMs) : '-'],
    ['Source resolution', asset.resolution || '-'],
    ['Stored on Sia', asset.totalStorageBytes > 0 ? formatBytes(asset.totalStorageBytes) : '-'],
    [
      'Master playlist',
      asset.manifestObjectId ? (
        <ObjectIdBadge key="m" value={asset.manifestObjectId} truncate={6} />
      ) : (
        '-'
      ),
    ],
    ['Created', formatDate(asset.createdAt)],
    ['Updated', formatDate(asset.updatedAt)],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4 text-sm">
            <span className="text-muted-foreground">{label}</span>
            <span className="min-w-0 truncate text-right">{value}</span>
          </div>
        ))}
        {asset.description && (
          <p className="mt-2 border-t pt-3 text-sm whitespace-pre-wrap text-muted-foreground">
            {asset.description}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

const TABS = ['playback', 'storage', 'renditions'] as const;
type Tab = (typeof TABS)[number];

function BackLink() {
  return (
    <Button variant="ghost" size="sm" className="mb-3 -ml-2" asChild>
      <Link to="/studio/assets">
        <ArrowLeft />
        Assets
      </Link>
    </Button>
  );
}

/** The page's own boxes, so the content lands without moving anything. */
function DetailSkeleton() {
  return (
    <div
      data-testid="asset-detail-skeleton"
      aria-hidden="true"
      className="animate-in duration-200 fill-mode-backwards fade-in delay-150"
    >
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex h-8 items-center">
            <Skeleton className="h-6 w-64 max-w-full" />
          </div>
          <div className="mt-2 flex h-5 items-center gap-2">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-3.5 w-24" />
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="flex flex-col gap-3">
            <Skeleton className="aspect-video w-full" />
            <Skeleton className="h-8 w-48" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2.5">
            {Array.from({ length: 9 }, (_, i) => (
              <div key={i} className="flex h-5 items-center justify-between gap-4">
                <Skeleton className="h-3.5 w-20" />
                <Skeleton className="h-3.5 w-24" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function AssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const asset = useAssetById(id);
  const ready = asset.data?.status === 'ready';
  const sia = useAssetSiaInfo(id, ready);
  const deleteAssets = useDeleteAssets();
  const update = useUpdateAssetMeta();
  const forgetAsset = useForgetAsset();
  const [edit, setEdit] = useState<{ draft: Draft; seq: number } | null>(null);
  const editShown = useFrozen(edit, edit !== null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleted = useRef<string | null>(null);
  const tabParam = params.get('tab');
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : 'playback';

  // drop the deleted asset's queries once this page no longer watches them;
  // removing a watched query makes it fetch again and answer 404
  useEffect(
    () => () => {
      if (deleted.current) forgetAsset(deleted.current);
    },
    [forgetAsset],
  );

  if (asset.isError || (!asset.isLoading && !asset.data)) {
    const notFound = (asset.error as { statusCode?: number } | null)?.statusCode === 404;
    return (
      <PageContainer>
        <Empty className="min-h-[60vh]">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              {notFound ? <FileQuestion /> : <AlertTriangle />}
            </EmptyMedia>
            <EmptyTitle>{notFound ? 'Asset not found' : 'Could not load this asset'}</EmptyTitle>
            <EmptyDescription>
              {notFound
                ? 'It may have been deleted, or it belongs to another account.'
                : asset.error?.message}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link to="/studio/assets">Back to assets</Link>
            </Button>
          </EmptyContent>
        </Empty>
      </PageContainer>
    );
  }

  const a = asset.data;

  const openEdit = (draft: Draft) => setEdit((e) => ({ draft, seq: (e?.seq ?? 0) + 1 }));

  const saveEdit = (draft: Draft) => {
    if (!a) return;
    setEdit(null);
    update.mutate(
      { id: a.id, data: draft },
      {
        onSuccess: () => toast.success('Asset updated'),
        onError: (err) =>
          toast.error(`Could not save: ${err instanceof Error ? err.message : String(err)}`, {
            action: { label: 'Edit again', onClick: () => openEdit(draft) },
          }),
      },
    );
  };

  const remove = async () => {
    if (!a) return;
    const failures = await deleteAssets.mutateAsync([a.id]);
    if (failures.length > 0) {
      setConfirmDelete(false);
      toast.error(`Could not delete: ${failures[0].error}`);
      return;
    }
    deleted.current = a.id;
    toast.success('Deleting the asset and unpinning it from Sia');
    navigate('/studio/assets');
  };

  const objectCount = sia.data?.totals.object_count;

  return (
    <PageContainer>
      <BackLink />
      <FadeSwap swapKey={a ? 'asset' : 'loading'}>
        {!a ? (
          <DetailSkeleton />
        ) : (
          <>
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <h1 className="truncate text-2xl font-semibold tracking-tight" title={a.title}>
                    {a.title}
                  </h1>
                  {update.isPending && (
                    <Spinner className="shrink-0 text-muted-foreground" aria-label="Saving" />
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <AssetStatusBadge status={a.status} live />
                  {a.accessTier === 'private' && (
                    <Badge variant="outline" className="animate-in duration-150 fade-in">
                      <Lock />
                      Private
                    </Badge>
                  )}
                  {!!a.durationMs && <span>{formatDuration(a.durationMs)}</span>}
                  {a.resolution && <span>{a.resolution}</span>}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  variant="outline"
                  onClick={() =>
                    openEdit({
                      title: a.title,
                      description: a.description,
                      accessTier: a.accessTier,
                    })
                  }
                >
                  <Pencil />
                  Edit
                </Button>
                <Button
                  variant="outline"
                  disabled={deleteAssets.isPending}
                  onClick={() => setConfirmDelete(true)}
                >
                  {deleteAssets.isPending ? <Spinner aria-hidden="true" /> : <Trash2 />}
                  {deleteAssets.isPending ? 'Deleting...' : 'Delete'}
                </Button>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <FadeSwap swapKey={ready ? 'player' : 'processing'} className="lg:col-span-2">
                {ready ? (
                  <Card>
                    <CardContent>
                      <AssetPlayer assetId={a.id} signed={a.accessTier === 'private'} />
                    </CardContent>
                  </Card>
                ) : (
                  <ProcessingCard asset={a} />
                )}
              </FadeSwap>
              <DetailsCard asset={a} />
            </div>

            <Collapse open={ready}>
              <Tabs
                value={tab}
                onValueChange={(v) =>
                  setParams(
                    (prev) => {
                      const next = new URLSearchParams(prev);
                      if (v === 'playback') next.delete('tab');
                      else next.set('tab', v);
                      return next;
                    },
                    { replace: true },
                  )
                }
                className="mt-6"
              >
                <TabsList className="max-w-full overflow-x-auto">
                  <TabsTrigger value="playback">Playback IDs</TabsTrigger>
                  <TabsTrigger value="storage">Sia storage</TabsTrigger>
                  <TabsTrigger value="renditions">Renditions</TabsTrigger>
                </TabsList>
                <TabsContent value="playback" className="mt-4">
                  <PlaybackIdsCard assetId={a.id} />
                </TabsContent>
                <TabsContent value="storage" className="mt-4">
                  <FadeSwap swapKey={sia.isLoading ? 'loading' : 'ready'}>
                    <SiaStorageBreakdown
                      info={sia.data}
                      isLoading={sia.isLoading}
                      error={sia.error}
                    />
                  </FadeSwap>
                </TabsContent>
                <TabsContent value="renditions" className="mt-4">
                  <RenditionsCard assetId={a.id} />
                </TabsContent>
              </Tabs>
            </Collapse>

            {editShown && (
              <EditDialog
                key={editShown.seq}
                draft={editShown.draft}
                open={edit !== null}
                onOpenChange={(o) => !o && setEdit(null)}
                onSave={saveEdit}
              />
            )}

            <AlertDialog
              open={confirmDelete}
              onOpenChange={(o) => !deleteAssets.isPending && setConfirmDelete(o)}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete {a.title}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The asset disappears now and its{' '}
                    {objectCount !== undefined ? `${objectCount.toLocaleString()} ` : ''}Sia objects
                    are unpinned in the background. This cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={deleteAssets.isPending}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    disabled={deleteAssets.isPending}
                    onClick={(e) => {
                      // stay open, busy, until the delete has an answer
                      e.preventDefault();
                      void remove();
                    }}
                  >
                    {deleteAssets.isPending && <Spinner aria-hidden="true" />}
                    {deleteAssets.isPending ? 'Deleting...' : 'Delete'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </FadeSwap>
    </PageContainer>
  );
}
