import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  FileVideo,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Upload as UploadIcon,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { AccessTier } from '@sluby/sdk';
import { PageContainer, PageHeader } from '@/components/layout/PageContainer';
import { ChunkStrip } from '@/components/upload/ChunkStrip';
import { PipelineSteps } from '@/components/upload/PipelineSteps';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { errorStatus } from '@/hooks/asset-queries';
import { formatBytes, formatDuration, formatRelativeTime } from '@/lib/formatters';
import { sluby } from '@/lib/sluby';
import { uploadStore as defaultStore } from '@/lib/studio-upload';
import {
  findUnfinishedUploads,
  forgetUnfinishedUpload,
  isSameFile,
  type UnfinishedUpload,
} from '@/lib/unfinished-uploads';
import {
  CHUNK_SIZE,
  isTransferring,
  useUploads,
  type UploadState,
  type UploadStore,
} from '@/lib/upload-store';
import { cn } from '@/lib/utils';

function titleFromFile(name: string): string {
  return (
    name
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ')
      .trim() || 'Untitled'
  );
}

function isVideo(file: File): boolean {
  // some browsers leave type empty for .mkv and friends; the server checks too
  return file.type === ''
    ? /\.(mp4|mov|m4v|mkv|webm|avi)$/i.test(file.name)
    : file.type.startsWith('video/');
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function DropZone({ onFiles }: { onFiles: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  // dragenter and dragleave fire for every child the pointer crosses, so
  // count them instead of trusting the last one
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Choose a video file or drop it here"
      onClick={() => input.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          input.current?.click();
        }
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        onFiles(Array.from(e.dataTransfer.files));
      }}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-16 text-center transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        dragging ? 'border-primary bg-primary/5' : 'hover:border-primary/50 hover:bg-muted/40',
      )}
    >
      <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <UploadIcon className="size-5" />
      </div>
      <div>
        <p className="font-medium">Drop a video here, or click to browse</p>
        <p className="mt-1 text-sm text-muted-foreground">
          MP4, MOV, MKV, WebM. One file at a time. A dropped connection is retried, and a failed
          upload can be resumed.
        </p>
      </div>
      <input
        ref={input}
        type="file"
        accept="video/*"
        className="hidden"
        data-testid="file-input"
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
    </div>
  );
}

function DetailsForm({
  file,
  onCancel,
  onStart,
}: {
  file: File;
  onCancel: () => void;
  onStart: (opts: { title: string; description: string; accessTier: AccessTier }) => void;
}) {
  const [title, setTitle] = useState(() => titleFromFile(file.name));
  const [description, setDescription] = useState('');
  const [accessTier, setAccessTier] = useState<AccessTier>('public');

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        onStart({ title: title.trim() || 'Untitled', description: description.trim(), accessTier });
      }}
    >
      <div className="flex items-center gap-3 rounded-lg border p-3">
        <FileVideo className="size-5 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={file.name}>
            {file.name}
          </p>
          <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Change
        </Button>
      </div>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="upload-title">Title</FieldLabel>
          <Input
            id="upload-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={200}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="upload-description">Description</FieldLabel>
          <Textarea
            id="upload-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="upload-access">Access</FieldLabel>
          <Select value={accessTier} onValueChange={(v) => setAccessTier(v as AccessTier)}>
            <SelectTrigger id="upload-access" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="public">Public</SelectItem>
              <SelectItem value="private">Private</SelectItem>
            </SelectContent>
          </Select>
          <FieldDescription>
            Private videos only play through signed, expiring URLs.
          </FieldDescription>
        </Field>
      </FieldGroup>
      <div className="flex gap-2">
        <Button type="submit">
          <UploadIcon />
          Start upload
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function UnfinishedRow({ upload, store }: { upload: UnfinishedUpload; store: UploadStore }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [wrongFile, setWrongFile] = useState<string | null>(null);
  const percent = upload.size > 0 ? Math.floor((upload.offset / upload.size) * 100) : 0;

  const discard = useMutation({
    mutationFn: async () => {
      try {
        // removes the partial file and the asset it created
        await sluby.uploads.cancel(upload.uploadId);
      } catch (err) {
        // gone already, or finished after all: either way nothing is left to discard
        if (errorStatus(err) !== 404 && errorStatus(err) !== 409) throw err;
      }
      forgetUnfinishedUpload(upload.storageKey);
    },
    onSuccess: () => {
      toast.success(`Discarded the unfinished upload of ${upload.fileName}`);
      void queryClient.invalidateQueries({ queryKey: ['uploads', 'unfinished'] });
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
    },
    onError: (err) => toast.error(`Could not discard: ${err.message}`),
  });

  const resumeWith = (file: File) => {
    if (!isSameFile(upload, file)) {
      setWrongFile(
        `${file.name} is not the file this upload started from. Choose ${upload.fileName} (${formatBytes(upload.size)}).`,
      );
      return;
    }
    setWrongFile(null);
    store.start(file, {
      title: upload.title,
      description: upload.description,
      accessTier: upload.accessTier,
    });
    void queryClient.invalidateQueries({ queryKey: ['uploads', 'unfinished'] });
  };

  return (
    <li className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={upload.title}>
            {upload.title || upload.fileName}
          </p>
          <p className="text-xs text-muted-foreground">
            {upload.fileName}, {formatBytes(upload.offset)} of {formatBytes(upload.size)} sent (
            {percent}%)
            {upload.createdAt && `, started ${formatRelativeTime(upload.createdAt)}`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => input.current?.click()}>
            <Play />
            Resume
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={discard.isPending}
            onClick={() => discard.mutate()}
          >
            <X />
            Discard
          </Button>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept="video/*"
        className="hidden"
        aria-label={`Choose ${upload.fileName} to resume its upload`}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) resumeWith(file);
          e.target.value = '';
        }}
      />
      {wrongFile && (
        <p role="alert" className="text-sm text-destructive">
          {wrongFile}
        </p>
      )}
    </li>
  );
}

function UnfinishedUploads({ store, known }: { store: UploadStore; known: Set<string> }) {
  const unfinished = useQuery({
    queryKey: ['uploads', 'unfinished'],
    queryFn: findUnfinishedUploads,
    staleTime: 0,
  });
  // uploads this page is already showing have their own controls
  const rows = (unfinished.data ?? []).filter((u) => !known.has(u.uploadId));
  if (unfinished.isError) {
    return (
      <p className="text-sm text-destructive">
        Could not check for unfinished uploads: {unfinished.error.message}
      </p>
    );
  }
  if (rows.length === 0) return null;

  return (
    <section aria-labelledby="unfinished-title" className="flex flex-col gap-2">
      <h2 id="unfinished-title" className="text-sm font-medium">
        Unfinished uploads
      </h2>
      <p className="text-sm text-muted-foreground">
        These stopped before they finished, for example when the page was closed. Choose the same
        file again to continue where it stopped, or discard it to remove the partial upload.
      </p>
      <ul className="flex flex-col gap-2">
        {rows.map((u) => (
          <UnfinishedRow key={u.storageKey} upload={u} store={store} />
        ))}
      </ul>
    </section>
  );
}

function TransferPanel({ store, s }: { store: UploadStore; s: UploadState }) {
  const percent = s.bytesTotal > 0 ? (s.bytesUploaded / s.bytesTotal) * 100 : 0;
  const remaining = s.bytesTotal - s.bytesUploaded;
  const eta = s.speed > 0 ? (remaining / s.speed) * 1000 : null;
  const controls = s.phase === 'uploading' || s.phase === 'paused';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <span className="text-3xl font-semibold tabular-nums">{Math.floor(percent)}%</span>
        <span className="text-sm text-muted-foreground tabular-nums">
          {formatBytes(s.bytesUploaded)} of {formatBytes(s.bytesTotal)}
        </span>
      </div>
      <Progress value={percent} aria-label="Upload progress" />
      <ChunkStrip
        bytesUploaded={s.bytesUploaded}
        bytesTotal={s.bytesTotal}
        chunkSize={CHUNK_SIZE}
        active={s.phase === 'uploading'}
      />
      {s.phase === 'finishing' && (
        <p className="text-sm text-muted-foreground">
          All bytes sent. Waiting for the server to confirm the upload.
        </p>
      )}
      {controls && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
          <span>
            {s.phase === 'paused'
              ? 'Paused'
              : s.speed > 0
                ? `${formatBytes(s.speed)}/s`
                : 'Starting...'}
          </span>
          {s.phase === 'uploading' && eta !== null && <span>{formatDuration(eta)} left</span>}
          <div className="ml-auto flex gap-2">
            {s.phase === 'uploading' ? (
              <Button variant="outline" size="sm" onClick={() => void store.pause(s.key)}>
                <Pause />
                Pause
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => store.resume(s.key)}>
                <Play />
                Resume
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => void store.cancel(s.key)}>
              <X />
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function CancelledPanel({ store, s }: { store: UploadStore; s: UploadState }) {
  if (s.cleanup === 'pending') {
    return <p className="text-sm text-muted-foreground">Cancelling and removing the upload...</p>;
  }
  if (s.cleanup === 'failed') {
    return (
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertTitle>Upload stopped, but not removed</AlertTitle>
        <AlertDescription>
          <p>{s.error}</p>
          <p>The partial file and its asset may still be on the server.</p>
          {s.uploadId && !s.authFailed && (
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              onClick={() => void store.retryCleanup(s.key)}
            >
              <RotateCcw />
              Try removing again
            </Button>
          )}
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <p className="text-sm text-muted-foreground">
      {s.cleanup === 'nothing'
        ? 'Upload cancelled before it reached the server.'
        : 'Upload cancelled. The partial file and its asset were removed.'}
    </p>
  );
}

const PHASE_BADGE = {
  uploading: { label: 'Uploading', variant: 'warning' },
  paused: { label: 'Paused', variant: 'secondary' },
  finishing: { label: 'Finishing', variant: 'warning' },
  processing: { label: 'Processing', variant: 'warning' },
  ready: { label: 'Ready', variant: 'success' },
  failed: { label: 'Failed', variant: 'destructive' },
  cancelled: { label: 'Cancelled', variant: 'secondary' },
} as const;

function failureTitle(s: UploadState): string {
  if (s.assetGone) return 'Video deleted';
  return s.failedDuring === 'upload' ? 'Upload failed' : 'Processing failed';
}

function UploadCard({ store, s }: { store: UploadStore; s: UploadState }) {
  const badge = PHASE_BADGE[s.phase];
  const assetLink = s.assetId && !s.assetGone && s.cleanup !== 'done' ? s.assetId : null;
  const dismissable = !isTransferring(s) && s.cleanup !== 'pending';

  return (
    <div className="grid gap-4 lg:grid-cols-3" data-testid="upload-card">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="truncate" title={s.title}>
            {s.title}
          </CardTitle>
          <CardDescription className="truncate" title={s.fileName}>
            {s.fileName}
          </CardDescription>
          <CardAction>
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {/* the badge changes silently; announce the phase instead */}
          <span className="sr-only" role="status" aria-live="polite">
            {s.title}: {badge.label}
          </span>
          {s.phase === 'cancelled' ? (
            <CancelledPanel store={store} s={s} />
          ) : (
            <TransferPanel store={store} s={s} />
          )}

          {s.notice && <p className="text-sm text-muted-foreground">{s.notice}</p>}

          {s.phase === 'processing' && (
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium">Processing</span>
                <span className="text-muted-foreground tabular-nums">
                  {s.job ? `${s.job.progressPercent}%` : 'waiting for the queue'}
                </span>
              </div>
              <Progress value={s.job?.progressPercent ?? 0} aria-label="Processing progress" />
              {s.job?.status === 'retrying' && (
                <p className="text-xs text-warning-foreground">
                  An attempt failed, retrying (attempt {s.job.retryCount + 1}).
                </p>
              )}
            </div>
          )}

          {s.error && s.phase !== 'failed' && s.phase !== 'cancelled' && (
            <p className="text-sm text-destructive">{s.error}</p>
          )}

          {s.phase === 'failed' && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>{failureTitle(s)}</AlertTitle>
              <AlertDescription>{s.error}</AlertDescription>
            </Alert>
          )}

          {s.job && s.job.logs.length > 0 && (
            <div className="max-h-48 overflow-y-auto rounded-lg bg-muted/50 p-3 font-mono text-xs">
              {s.job.logs.map((line, i) => (
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

          <div className="flex flex-wrap gap-2">
            {s.phase === 'ready' && assetLink && (
              <Button asChild>
                <Link to={`/studio/assets/${assetLink}`}>
                  <Play />
                  Open asset
                </Link>
              </Button>
            )}
            {s.phase === 'failed' && s.failedDuring === 'upload' && s.canResume && (
              <Button
                disabled={store.busy()}
                title={store.busy() ? 'Another upload is in progress' : undefined}
                onClick={() => store.resumeTransfer(s.key)}
              >
                <Play />
                Resume upload
              </Button>
            )}
            {s.phase === 'failed' &&
              s.failedDuring === 'processing' &&
              !s.assetGone &&
              !s.authFailed && (
                <Button onClick={() => void store.retryProcessing(s.key)}>
                  <RotateCcw />
                  Retry processing
                </Button>
              )}
            {s.phase === 'processing' && s.pollStopped && !s.authFailed && (
              <Button variant="outline" onClick={() => store.refresh(s.key)}>
                <RefreshCw />
                Check again
              </Button>
            )}
            {(s.phase === 'processing' || s.phase === 'failed') && assetLink && (
              <Button variant="outline" asChild>
                <Link to={`/studio/assets/${assetLink}`}>View asset</Link>
              </Button>
            )}
            {dismissable && (
              <Button variant="ghost" onClick={() => store.dismiss(s.key)}>
                Dismiss
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Pipeline</CardTitle>
        </CardHeader>
        <CardContent>
          <PipelineSteps state={s} />
        </CardContent>
      </Card>
    </div>
  );
}

export default function UploadPage({ store = defaultStore }: { store?: UploadStore }) {
  const { uploads } = useUploads(store);
  const [file, setFile] = useState<File | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);
  const [ignored, setIgnored] = useState<string | null>(null);
  const busy = uploads.some(isTransferring);
  const known = new Set(uploads.map((u) => u.uploadId).filter((id): id is string => !!id));

  const choose = (files: File[]) => {
    const [first, ...rest] = files;
    setIgnored(
      rest.length > 0
        ? `Only one file uploads at a time, so ${plural(rest.length, 'other file')} ${rest.length === 1 ? 'was' : 'were'} not added.`
        : null,
    );
    if (!first) return;
    if (!isVideo(first)) {
      setRejected(`${first.name} is not a video file.`);
      return;
    }
    setRejected(null);
    setFile(first);
  };

  return (
    <PageContainer>
      <PageHeader
        title="Upload"
        description="Videos are transcoded to adaptive HLS and stored on Sia"
      />
      <div className="flex flex-col gap-6">
        {!busy && (
          <Card className="max-w-2xl">
            <CardContent className="flex flex-col gap-4">
              {file ? (
                <DetailsForm
                  file={file}
                  onCancel={() => setFile(null)}
                  onStart={(opts) => {
                    store.start(file, opts);
                    setFile(null);
                    setIgnored(null);
                  }}
                />
              ) : (
                <DropZone onFiles={choose} />
              )}
              {rejected && (
                <p role="alert" className="text-sm text-destructive">
                  {rejected}
                </p>
              )}
              {ignored && (
                <p role="status" className="text-sm text-muted-foreground">
                  {ignored}
                </p>
              )}
              {!file && <UnfinishedUploads store={store} known={known} />}
            </CardContent>
          </Card>
        )}
        {uploads.map((u) => (
          <UploadCard key={u.key} store={store} s={u} />
        ))}
      </div>
    </PageContainer>
  );
}
