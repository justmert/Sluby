import { useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  AlertTriangle,
  FileVideo,
  Pause,
  Play,
  RotateCcw,
  Upload as UploadIcon,
  X,
} from 'lucide-react';
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
import { formatBytes, formatDuration } from '@/lib/formatters';
import { uploadStore as defaultStore } from '@/lib/studio-upload';
import { CHUNK_SIZE, useUploadState, type UploadStore } from '@/lib/upload-store';
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

// ---------------------------------------------------------------------------
// Selecting a file
// ---------------------------------------------------------------------------

function DropZone({ onFile }: { onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
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
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) onFile(file);
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
          MP4, MOV, MKV, WebM. Uploads are resumable and survive dropped connections.
        </p>
      </div>
      <input
        ref={input}
        type="file"
        accept="video/*"
        className="hidden"
        data-testid="file-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
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
          <p className="truncate text-sm font-medium">{file.name}</p>
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

// ---------------------------------------------------------------------------
// In flight
// ---------------------------------------------------------------------------

function TransferPanel({ store }: { store: UploadStore }) {
  const s = useUploadState(store);
  const percent = s.bytesTotal > 0 ? (s.bytesUploaded / s.bytesTotal) * 100 : 0;
  const remaining = s.bytesTotal - s.bytesUploaded;
  const eta = s.speed > 0 ? (remaining / s.speed) * 1000 : null;
  const transferring = s.phase === 'uploading' || s.phase === 'paused';

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
      {transferring && (
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
              <Button variant="outline" size="sm" onClick={() => void store.pause()}>
                <Pause />
                Pause
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => store.resume()}>
                <Play />
                Resume
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => void store.cancel()}>
              <X />
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function ProcessingLog({ store }: { store: UploadStore }) {
  const { job } = useUploadState(store);
  if (!job || job.logs.length === 0) return null;
  return (
    <div className="max-h-48 overflow-y-auto rounded-lg bg-muted/50 p-3 font-mono text-xs">
      {job.logs.map((line, i) => (
        <div key={i} className="flex gap-3">
          <span className="shrink-0 text-muted-foreground">
            {new Date(line.timestamp).toLocaleTimeString()}
          </span>
          <span className="shrink-0 text-primary">{line.stage}</span>
          <span className="min-w-0 break-words">{line.message}</span>
        </div>
      ))}
    </div>
  );
}

const PHASE_BADGE = {
  uploading: { label: 'Uploading', variant: 'warning' },
  paused: { label: 'Paused', variant: 'secondary' },
  processing: { label: 'Processing', variant: 'warning' },
  ready: { label: 'Ready', variant: 'success' },
  failed: { label: 'Failed', variant: 'destructive' },
  cancelled: { label: 'Cancelled', variant: 'secondary' },
} as const;

function ActiveUpload({ store }: { store: UploadStore }) {
  const s = useUploadState(store);
  if (s.phase === 'idle') return null;
  const badge = PHASE_BADGE[s.phase];

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="truncate">{s.title}</CardTitle>
          <CardDescription className="truncate">{s.fileName}</CardDescription>
          <CardAction>
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {s.phase === 'cancelled' ? (
            <p className="text-sm text-muted-foreground">
              Upload cancelled. The partial file and its asset were removed.
            </p>
          ) : (
            <TransferPanel store={store} />
          )}

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

          {s.error && s.phase !== 'failed' && <p className="text-sm text-destructive">{s.error}</p>}

          {s.phase === 'failed' && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>
                {s.failedDuring === 'upload' ? 'Upload failed' : 'Processing failed'}
              </AlertTitle>
              <AlertDescription>{s.error}</AlertDescription>
            </Alert>
          )}

          <ProcessingLog store={store} />

          <div className="flex flex-wrap gap-2">
            {s.phase === 'ready' && s.assetId && (
              <Button asChild>
                <Link to={`/studio/assets/${s.assetId}`}>
                  <Play />
                  Open asset
                </Link>
              </Button>
            )}
            {s.phase === 'failed' && s.failedDuring === 'processing' && (
              <Button onClick={() => void store.retryProcessing()}>
                <RotateCcw />
                Retry processing
              </Button>
            )}
            {s.phase === 'processing' && s.assetId && (
              <Button variant="outline" asChild>
                <Link to={`/studio/assets/${s.assetId}`}>View asset</Link>
              </Button>
            )}
            {(s.phase === 'ready' || s.phase === 'failed' || s.phase === 'cancelled') && (
              <Button variant="outline" onClick={() => store.reset()}>
                <UploadIcon />
                Upload another
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

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function UploadPage({ store = defaultStore }: { store?: UploadStore }) {
  const s = useUploadState(store);
  const [file, setFile] = useState<File | null>(null);
  const [rejected, setRejected] = useState<string | null>(null);

  const choose = (f: File) => {
    if (!isVideo(f)) {
      setRejected(`${f.name} is not a video file.`);
      return;
    }
    setRejected(null);
    setFile(f);
  };

  return (
    <PageContainer>
      <PageHeader
        title="Upload"
        description="Videos are transcoded to adaptive HLS and stored on Sia"
      />
      {s.phase !== 'idle' ? (
        <ActiveUpload store={store} />
      ) : (
        <Card className="max-w-2xl">
          <CardContent className="flex flex-col gap-4">
            {file ? (
              <DetailsForm
                file={file}
                onCancel={() => setFile(null)}
                onStart={(opts) => {
                  store.start(file, opts);
                  setFile(null);
                }}
              />
            ) : (
              <DropZone onFile={choose} />
            )}
            {rejected && (
              <p role="alert" className="text-sm text-destructive">
                {rejected}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
}
