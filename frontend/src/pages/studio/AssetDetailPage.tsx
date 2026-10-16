import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { AlertTriangle, ArrowLeft, Lock, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import type { AccessTier, RetryStage, VideoAsset } from '@sluby/sdk';
import { PageContainer } from '@/components/layout/PageContainer';
import { AssetPlayer } from '@/components/asset/AssetPlayer';
import { AssetStatusBadge } from '@/components/asset/AssetStatusBadge';
import { SiaStorageBreakdown } from '@/components/asset/SiaStorageBreakdown';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import { formatBitrate, formatBytes, formatDate, formatDuration } from '@/lib/formatters';

function EditDialog({
  asset,
  open,
  onOpenChange,
}: {
  asset: VideoAsset;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const update = useUpdateAssetMeta();
  const [title, setTitle] = useState(asset.title);
  const [description, setDescription] = useState(asset.description);
  const [accessTier, setAccessTier] = useState<AccessTier>(asset.accessTier);
  const [titleError, setTitleError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setTitleError('Enter a title.');
      return;
    }
    try {
      await update.mutateAsync({
        id: asset.id,
        data: { title: trimmed, description: description.trim(), accessTier },
      });
      toast.success('Asset updated');
      onOpenChange(false);
    } catch (err) {
      toast.error(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
    }
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
            <Button type="submit" disabled={update.isPending}>
              Save
            </Button>
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
          {job.data
            ? `Stage: ${job.data.stage}${job.data.status === 'retrying' ? ' (retrying)' : ''}`
            : asset.status === 'uploading' || asset.status === 'created'
              ? 'Waiting for the upload to finish'
              : 'Waiting for the queue'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {job.data && !failed && (
          <Progress value={job.data.progressPercent} aria-label="Processing progress" />
        )}
        {failed && (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>The pipeline stopped</AlertTitle>
            <AlertDescription>
              {job.data?.errorMessage ?? 'No error message was recorded.'}
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
            <RotateCcw />
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
          <Skeleton className="mx-4 h-32" />
        ) : renditions.isError ? (
          <p className="px-4 text-sm text-destructive">{renditions.error.message}</p>
        ) : rows.length === 0 ? (
          <p className="px-4 text-sm text-muted-foreground">
            No rendition records for this asset. Assets stored before renditions were recorded only
            list their objects in the Sia breakdown.
          </p>
        ) : (
          <Table>
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
                  <TableCell className="pl-4 font-medium">{r.name}</TableCell>
                  <TableCell className="tabular-nums">
                    {r.width && r.height ? `${r.width}x${r.height}` : '-'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.video_bitrate_kbps ? formatBitrate(r.video_bitrate_kbps * 1000) : '-'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{r.segment_count}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatBytes(r.byte_size)}
                  </TableCell>
                  <TableCell>
                    <ObjectIdBadge value={r.playlist_object_id} truncate={6} />
                  </TableCell>
                  <TableCell className="pr-4">
                    <ObjectIdBadge value={r.data_object_id} truncate={6} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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

export default function AssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const asset = useAssetById(id);
  const ready = asset.data?.status === 'ready';
  const sia = useAssetSiaInfo(id, ready);
  const deleteAssets = useDeleteAssets();
  const forgetAsset = useForgetAsset();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleted = useRef<string | null>(null);

  // drop the deleted asset's queries once this page no longer watches them;
  // removing a watched query makes it fetch again and answer 404
  useEffect(
    () => () => {
      if (deleted.current) forgetAsset(deleted.current);
    },
    [forgetAsset],
  );

  if (asset.isLoading) {
    return (
      <PageContainer>
        <Skeleton className="mb-6 h-8 w-64" />
        <Skeleton className="aspect-video w-full max-w-4xl" />
      </PageContainer>
    );
  }

  if (asset.isError || !asset.data) {
    const notFound = (asset.error as { statusCode?: number } | null)?.statusCode === 404;
    return (
      <PageContainer>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{notFound ? 'Asset not found' : 'Could not load this asset'}</EmptyTitle>
            <EmptyDescription>
              {notFound
                ? 'It may have been deleted, or it belongs to another account.'
                : asset.error?.message}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" asChild>
              <Link to="/studio/assets">Back to assets</Link>
            </Button>
          </EmptyContent>
        </Empty>
      </PageContainer>
    );
  }

  const a = asset.data;

  const remove = async () => {
    setConfirmDelete(false);
    const failures = await deleteAssets.mutateAsync([a.id]);
    if (failures.length > 0) {
      toast.error(`Could not delete: ${failures[0].error}`);
      return;
    }
    deleted.current = a.id;
    toast.success('Deleting the asset and unpinning it from Sia');
    navigate('/studio/assets');
  };

  return (
    <PageContainer>
      <Button variant="ghost" size="sm" className="mb-3 -ml-2" asChild>
        <Link to="/studio/assets">
          <ArrowLeft />
          Assets
        </Link>
      </Button>

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight" title={a.title}>
            {a.title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <AssetStatusBadge status={a.status} />
            {a.accessTier === 'private' && (
              <Badge variant="outline">
                <Lock />
                Private
              </Badge>
            )}
            {!!a.durationMs && <span>{formatDuration(a.durationMs)}</span>}
            {a.resolution && <span>{a.resolution}</span>}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil />
            Edit
          </Button>
          <Button variant="outline" onClick={() => setConfirmDelete(true)}>
            <Trash2 />
            Delete
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {ready ? (
            <Card>
              <CardContent>
                <AssetPlayer assetId={a.id} signed={a.accessTier === 'private'} />
              </CardContent>
            </Card>
          ) : (
            <ProcessingCard asset={a} />
          )}
        </div>
        <DetailsCard asset={a} />
      </div>

      {ready && (
        <Tabs defaultValue="storage" className="mt-6">
          <TabsList>
            <TabsTrigger value="storage">Sia storage</TabsTrigger>
            <TabsTrigger value="renditions">Renditions</TabsTrigger>
          </TabsList>
          <TabsContent value="storage" className="mt-4">
            <SiaStorageBreakdown info={sia.data} isLoading={sia.isLoading} error={sia.error} />
          </TabsContent>
          <TabsContent value="renditions" className="mt-4">
            <RenditionsCard assetId={a.id} />
          </TabsContent>
        </Tabs>
      )}

      {editing && <EditDialog asset={a} open={editing} onOpenChange={setEditing} />}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {a.title}?</AlertDialogTitle>
            <AlertDialogDescription>
              The asset disappears now and its {sia.data?.totals.object_count ?? ''} Sia objects are
              unpinned in the background. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void remove()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
