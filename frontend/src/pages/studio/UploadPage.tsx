import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Clock,
  FileVideo,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Upload as UploadIcon,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { AccessTier, VideoAsset } from '@sluby/sdk';
import { PageContainer, PageHeader } from '@/components/layout/PageContainer';
import {
  AnimatedItem,
  AnimatedList,
  Collapse,
  FadeSwap,
  NumberTicker,
  StatusTransition,
} from '@/components/motion';
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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { useProcessingJob } from '@/hooks/asset-detail-queries';
import { errorStatus, useAssetList } from '@/hooks/asset-queries';
import { formatBytes, formatRelativeTime } from '@/lib/formatters';
import { fadeUp, spring } from '@/lib/motion';
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
  type QueuedUpload,
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

const percentText = (n: number) => `${Math.floor(n)}%`;

/** A rough time left: precise seconds would only flicker. */
function formatEta(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 10) return 'a few seconds left';
  if (s < 60) return `about ${Math.max(10, Math.round(s / 5) * 5)} s left`;
  const min = Math.round(s / 60);
  if (min < 60) return `about ${min} min left`;
  return `about ${Math.floor(min / 60)} h ${min % 60} min left`;
}

function formatSpent(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const min = Math.floor(s / 60);
  return s % 60 === 0 ? `${min} min` : `${min} min ${s % 60} s`;
}

// speed over the first moments of a transfer swings too much to promise a time
const ETA_AFTER_MS = 3_000;

const ButtonSpinner = () => <Spinner role={undefined} aria-hidden="true" />;

function DropZone({ onFiles, busy }: { onFiles: (files: File[]) => void; busy: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  // dragenter and dragleave fire for every child the pointer crosses, so
  // count them instead of trusting the last one
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);

  return (
    <m.div
      role="button"
      tabIndex={0}
      aria-label="Choose video files or drop them here"
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
      animate={{ scale: dragging ? 1.015 : 1 }}
      transition={spring}
      data-dragging={dragging || undefined}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-4 text-center transition-colors duration-150 outline-none focus-visible:ring-3 focus-visible:ring-ring sm:px-6',
        busy ? 'py-8' : 'py-12 sm:py-16',
        dragging
          ? 'border-primary bg-primary/5'
          : 'hover:border-primary/50 hover:bg-muted/40 active:bg-muted/60',
      )}
    >
      <m.div
        animate={{ y: dragging ? -3 : 0 }}
        transition={spring}
        className={cn(
          'flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors duration-150',
          dragging && 'bg-primary text-primary-foreground',
        )}
      >
        <UploadIcon className="size-5" />
      </m.div>
      <div>
        <p className="font-medium">
          {dragging ? 'Drop to add' : 'Drop videos here, or click to browse'}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {busy
            ? 'Files you add now start when the current transfer is done.'
            : 'MP4, MOV, MKV, WebM. Several files upload one after another. A dropped connection is retried, and a failed upload can be resumed.'}
        </p>
      </div>
      <input
        ref={input}
        type="file"
        accept="video/*"
        multiple
        className="hidden"
        data-testid="file-input"
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
    </m.div>
  );
}

interface Draft {
  id: string;
  file: File;
  title: string;
}

let draftSeq = 0;
const toDraft = (file: File): Draft => ({
  id: `draft-${++draftSeq}`,
  file,
  title: titleFromFile(file.name),
});

function DetailsForm({
  drafts,
  busy,
  onChange,
  onCancel,
  onStart,
}: {
  drafts: Draft[];
  busy: boolean;
  onChange: (drafts: Draft[]) => void;
  onCancel: () => void;
  onStart: (opts: { description: string; accessTier: AccessTier }) => void;
}) {
  const [description, setDescription] = useState('');
  const [accessTier, setAccessTier] = useState<AccessTier>('public');
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const [submitted, setSubmitted] = useState(false);
  const single = drafts.length === 1;
  const titleError = (d: Draft) =>
    (submitted || touched.has(d.id)) && d.title.trim() === ''
      ? 'Give the video a title, so you can find it later.'
      : null;
  const total = drafts.reduce((sum, d) => sum + d.file.size, 0);

  return (
    <form
      className="flex flex-col gap-6"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const empty = drafts.find((d) => d.title.trim() === '');
        if (empty) {
          setSubmitted(true);
          document.getElementById(`title-${empty.id}`)?.focus();
          return;
        }
        onStart({ description: description.trim(), accessTier });
      }}
    >
      {single ? (
        <div className="flex items-center gap-3 rounded-lg border p-3">
          <FileVideo className="size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium" title={drafts[0].file.name}>
              {drafts[0].file.name}
            </p>
            <p className="text-xs text-muted-foreground">{formatBytes(drafts[0].file.size)}</p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Change
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {plural(drafts.length, 'video')}, {formatBytes(total)} in all. They upload one after
          another, in this order.
        </p>
      )}
      <FieldGroup>
        {single ? (
          <Field data-invalid={!!titleError(drafts[0]) || undefined}>
            <FieldLabel htmlFor={`title-${drafts[0].id}`}>Title</FieldLabel>
            <Input
              id={`title-${drafts[0].id}`}
              value={drafts[0].title}
              onChange={(e) => onChange([{ ...drafts[0], title: e.target.value }])}
              onBlur={() => setTouched((t) => new Set(t).add(drafts[0].id))}
              aria-invalid={!!titleError(drafts[0]) || undefined}
              maxLength={200}
            />
            <FieldError>{titleError(drafts[0])}</FieldError>
          </Field>
        ) : (
          <AnimatedList as="ul" className="flex flex-col gap-2" aria-label="Videos to upload">
            {drafts.map((d, i) => (
              <AnimatedItem key={d.id} className="flex flex-col gap-1.5 rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-xs text-muted-foreground tabular-nums">
                    {i + 1}.
                  </span>
                  <Input
                    id={`title-${d.id}`}
                    aria-label={`Title for ${d.file.name}`}
                    value={d.title}
                    onChange={(e) =>
                      onChange(
                        drafts.map((x) => (x.id === d.id ? { ...x, title: e.target.value } : x)),
                      )
                    }
                    onBlur={() => setTouched((t) => new Set(t).add(d.id))}
                    aria-invalid={!!titleError(d) || undefined}
                    maxLength={200}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Leave out ${d.file.name}`}
                    onClick={() => onChange(drafts.filter((x) => x.id !== d.id))}
                  >
                    <X />
                  </Button>
                </div>
                <p className="truncate pl-7 text-xs text-muted-foreground" title={d.file.name}>
                  {d.file.name}, {formatBytes(d.file.size)}
                </p>
                <FieldError className="pl-7">{titleError(d)}</FieldError>
              </AnimatedItem>
            ))}
          </AnimatedList>
        )}
        {single && (
          <Field>
            <FieldLabel htmlFor="upload-description">Description</FieldLabel>
            <Textarea
              id="upload-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </Field>
        )}
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
            {!single && ' This applies to every video in the list.'}
          </FieldDescription>
        </Field>
      </FieldGroup>
      <div className="flex flex-wrap gap-2">
        <Button type="submit">
          <UploadIcon />
          {single
            ? busy
              ? 'Add to queue'
              : 'Start upload'
            : busy
              ? `Queue ${plural(drafts.length, 'video')}`
              : `Upload ${plural(drafts.length, 'video')}`}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function UnfinishedRow({
  upload,
  onResume,
}: {
  upload: UnfinishedUpload;
  onResume: (f: File) => string | null;
}) {
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
    onError: (err) => toast.error(`Could not discard ${upload.fileName}: ${err.message}`),
  });

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
          <Button size="sm" onClick={() => input.current?.click()} disabled={discard.isPending}>
            <Play />
            Resume
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={discard.isPending}
            onClick={() => discard.mutate()}
          >
            {discard.isPending ? <ButtonSpinner /> : <X />}
            {discard.isPending ? 'Discarding...' : 'Discard'}
          </Button>
        </div>
      </div>
      <Progress value={percent} aria-label={`${upload.fileName} sent so far`} />
      <input
        ref={input}
        type="file"
        accept="video/*"
        className="hidden"
        aria-label={`Choose ${upload.fileName} to resume its upload`}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) setWrongFile(onResume(file));
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

function UnfinishedUploads({
  rows,
  error,
  onResume,
}: {
  rows: UnfinishedUpload[];
  error: Error | null;
  onResume: (u: UnfinishedUpload, f: File) => string | null;
}) {
  if (error) {
    return (
      <p className="text-sm text-destructive">
        Could not check for unfinished uploads: {error.message}
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
        These stopped before they finished, for example when the page was closed. Choose or drop the
        same file again and it continues where it stopped. Discard removes the partial upload.
      </p>
      <ul className="flex flex-col gap-2">
        {rows.map((u) => (
          <UnfinishedRow key={u.storageKey} upload={u} onResume={(f) => onResume(u, f)} />
        ))}
      </ul>
    </section>
  );
}

function TransferPanel({ store, s }: { store: UploadStore; s: UploadState }) {
  const [pausing, setPausing] = useState(false);
  const percent = s.bytesTotal > 0 ? (s.bytesUploaded / s.bytesTotal) * 100 : 0;
  const remaining = s.bytesTotal - s.bytesUploaded;
  const eta = s.speed > 0 && s.activeMs >= ETA_AFTER_MS ? (remaining / s.speed) * 1000 : null;
  const controls = s.phase === 'uploading' || s.phase === 'paused';

  const pause = async () => {
    setPausing(true);
    try {
      await store.pause(s.key);
    } finally {
      setPausing(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-4">
        <NumberTicker value={percent} format={percentText} className="text-3xl font-semibold" />
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
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <ButtonSpinner />
          All bytes sent. Waiting for the server to confirm the upload.
        </p>
      )}
      {controls && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          <span className="tabular-nums">
            {s.phase === 'paused'
              ? 'Paused'
              : s.speed > 0
                ? `${formatBytes(s.speed)}/s`
                : 'Measuring speed...'}
          </span>
          {s.phase === 'uploading' && eta !== null && (
            <span className="tabular-nums">{formatEta(eta)}</span>
          )}
          <div className="ml-auto flex gap-2">
            {s.phase === 'uploading' ? (
              <Button variant="outline" size="sm" disabled={pausing} onClick={() => void pause()}>
                {pausing ? <ButtonSpinner /> : <Pause />}
                {pausing ? 'Pausing...' : 'Pause'}
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

/** What is left of the transfer once it is done: one line instead of the whole meter. */
function TransferDone({ s }: { s: UploadState }) {
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
      <span>
        Uploaded {formatBytes(s.bytesTotal)}
        {s.activeMs > 0 && ` in ${formatSpent(s.activeMs)}`}
      </span>
    </p>
  );
}

function CancelledPanel({ store, s }: { store: UploadStore; s: UploadState }) {
  const [retrying, setRetrying] = useState(false);
  if (s.cleanup === 'pending') {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <ButtonSpinner />
        Cancelling and removing the upload...
      </p>
    );
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
              disabled={retrying}
              onClick={() => {
                setRetrying(true);
                void store.retryCleanup(s.key).finally(() => setRetrying(false));
              }}
            >
              {retrying ? <ButtonSpinner /> : <RotateCcw />}
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

const STAGE_LABEL: Record<string, string> = {
  queued: 'Waiting in the queue',
  transcode: 'Transcoding',
  upload: 'Storing on Sia',
  finalize: 'Finalizing',
};

/**
 * The job's percent, never lower than what this attempt already showed:
 * progress writes from the worker can land out of order. A retry starts over.
 */
function useSteadyPercent(job: UploadState['job']) {
  const attempt = job?.retryCount ?? -1;
  const value = job?.progressPercent ?? 0;
  const [peak, setPeak] = useState({ attempt, value });
  if (peak.attempt !== attempt || value > peak.value) setPeak({ attempt, value });
  return peak.attempt === attempt ? Math.max(peak.value, value) : value;
}

function ProcessingPanel({ s }: { s: UploadState }) {
  const percent = useSteadyPercent(s.job);
  const stage = s.job ? (STAGE_LABEL[s.job.stage] ?? 'Processing') : 'Waiting for the queue';
  const waiting = !s.job || s.job.stage === 'queued';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="font-medium">{stage}</span>
        {!waiting && (
          <NumberTicker value={percent} format={percentText} className="text-muted-foreground" />
        )}
      </div>
      {waiting ? (
        // no number to show yet, so a slow sweep instead of a bar stuck at 0
        <div
          role="progressbar"
          aria-label="Processing progress"
          aria-valuetext="Waiting in the queue"
          className="relative h-1 overflow-hidden rounded-full bg-muted before:absolute before:inset-y-0 before:w-1/3 before:-translate-x-full before:rounded-full before:bg-primary/60 motion-safe:before:animate-shimmer motion-reduce:before:hidden"
        />
      ) : (
        // polls land every two seconds; easing over most of that keeps the bar moving
        <Progress
          value={percent}
          aria-label="Processing progress"
          className="[&>[data-slot=progress-indicator]]:duration-[1800ms]"
        />
      )}
      {s.job?.status === 'retrying' && (
        <p className="text-xs text-warning-foreground">
          An attempt failed, retrying (attempt {s.job.retryCount + 1}).
        </p>
      )}
    </div>
  );
}

function JobLog({ s }: { s: UploadState }) {
  const logs = s.job?.logs ?? [];
  const [open, setOpen] = useState(false);
  if (logs.length === 0) return null;
  const last = logs[logs.length - 1];
  const id = `log-${s.key}`;
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="flex min-w-0 items-center gap-2 rounded-md text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ChevronDown
          className={cn(
            'size-3.5 shrink-0 transition-transform duration-200 ease-out-soft',
            open && 'rotate-180',
          )}
        />
        <span className="shrink-0 font-medium">Log ({logs.length})</span>
        {!open && <span className="min-w-0 truncate">{last.message}</span>}
      </button>
      <Collapse open={open} id={id}>
        <div className="max-h-48 overflow-y-auto rounded-lg bg-muted/50 p-3 font-mono text-xs">
          {logs.map((line, i) => (
            <div key={i} className="flex gap-3">
              <span className="shrink-0 text-muted-foreground">
                {new Date(line.timestamp).toLocaleTimeString()}
              </span>
              <span className="shrink-0 text-primary">{line.stage}</span>
              <span className="min-w-0 break-words">{line.message}</span>
            </div>
          ))}
        </div>
      </Collapse>
    </div>
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

/**
 * A ring that lights up once and fades when an upload lands on ready or
 * failed. It is skipped for cards that were already settled when the page
 * opened, since nothing just happened to them.
 */
function SettleFlash({ phase }: { phase: UploadState['phase'] }) {
  const tone = phase === 'ready' ? 'ring-success' : phase === 'failed' ? 'ring-destructive' : null;
  return (
    <AnimatePresence initial={false}>
      {tone && (
        <m.span
          key={phase}
          aria-hidden="true"
          className={cn('pointer-events-none absolute inset-0 rounded-xl ring-2 ring-inset', tone)}
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 1.4, delay: 0.3, ease: 'easeOut' }}
        />
      )}
    </AnimatePresence>
  );
}

function UploadCard({ store, s, busy }: { store: UploadStore; s: UploadState; busy: boolean }) {
  const badge = PHASE_BADGE[s.phase];
  const assetLink = s.assetId && !s.assetGone && s.cleanup !== 'done' ? s.assetId : null;
  const dismissable = !isTransferring(s) && s.cleanup !== 'pending';
  const [retrying, setRetrying] = useState(false);
  const sent = !isTransferring(s) && s.phase !== 'cancelled' && s.failedDuring !== 'upload';

  return (
    <Card className="relative" data-testid="upload-card" data-phase={s.phase}>
      <SettleFlash phase={s.phase} />
      <CardHeader>
        <CardTitle className="truncate" title={s.title}>
          {s.title}
        </CardTitle>
        <CardDescription className="truncate" title={s.fileName}>
          {s.fileName}
        </CardDescription>
        <CardAction>
          <StatusTransition status={s.phase} pulse={s.phase === 'processing'}>
            <Badge variant={badge.variant}>{badge.label}</Badge>
          </StatusTransition>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_15rem]">
        <div className="flex min-w-0 flex-col gap-5">
          {/* the badge changes silently; announce the phase instead */}
          <span className="sr-only" role="status" aria-live="polite">
            {s.title}: {badge.label}
          </span>
          <FadeSwap swapKey={s.phase === 'cancelled' ? 'cancelled' : sent ? 'sent' : 'sending'}>
            {s.phase === 'cancelled' ? (
              <CancelledPanel store={store} s={s} />
            ) : sent ? (
              <TransferDone s={s} />
            ) : (
              <TransferPanel store={store} s={s} />
            )}
          </FadeSwap>

          {s.notice && <p className="text-sm text-muted-foreground">{s.notice}</p>}

          <Collapse open={s.phase === 'processing'}>
            <ProcessingPanel s={s} />
          </Collapse>

          {s.error && s.phase !== 'failed' && s.phase !== 'cancelled' && (
            <p className="text-sm text-destructive">{s.error}</p>
          )}

          {s.phase === 'failed' && (
            <m.div variants={fadeUp} initial="hidden" animate="visible">
              <Alert variant="destructive">
                <AlertTriangle />
                <AlertTitle>{failureTitle(s)}</AlertTitle>
                <AlertDescription>{s.error}</AlertDescription>
              </Alert>
            </m.div>
          )}

          <JobLog s={s} />

          <div className="flex flex-wrap gap-2 empty:hidden">
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
                disabled={busy}
                title={busy ? 'Another upload is in progress' : undefined}
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
                <Button
                  disabled={retrying}
                  onClick={() => {
                    setRetrying(true);
                    void store.retryProcessing(s.key).finally(() => setRetrying(false));
                  }}
                >
                  {retrying ? <ButtonSpinner /> : <RotateCcw />}
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
        </div>
        <div className="border-t pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
          <h3 className="sr-only">Pipeline</h3>
          {/* once nothing is running the step explanations are only clutter */}
          <PipelineSteps
            state={s}
            compact={s.phase === 'ready' || s.phase === 'cancelled' || s.phase === 'failed'}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function QueuedList({
  queued,
  held,
  onRemove,
  onContinue,
}: {
  queued: QueuedUpload[];
  held: boolean;
  onRemove: (key: string) => void;
  onContinue: () => void;
}) {
  return (
    <AnimatePresence initial={false}>
      {queued.length > 0 && (
        <m.section
          key="queue"
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          exit="exit"
          aria-labelledby="queue-title"
          className="flex flex-col gap-2"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="queue-title" className="text-sm font-medium">
              Up next{' '}
              <span className="font-normal text-muted-foreground">
                ({plural(queued.length, 'video')})
              </span>
            </h2>
          </div>
          {held && (
            <Alert>
              <Clock />
              <AlertTitle>The queue is waiting</AlertTitle>
              <AlertDescription>
                <p>
                  The last transfer failed, so the rest did not start on their own. Resume that
                  upload, or go on with the next one.
                </p>
                <Button size="sm" variant="outline" className="mt-2" onClick={onContinue}>
                  <Play />
                  Continue with the next
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <AnimatedList as="ul" className="flex flex-col gap-2" aria-label="Queued videos">
            {queued.map((q, i) => (
              <AnimatedItem
                key={q.key}
                className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2"
              >
                <span className="w-5 shrink-0 text-xs text-muted-foreground tabular-nums">
                  {i + 1}.
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium" title={q.title}>
                    {q.title}
                  </p>
                  <p className="truncate text-xs text-muted-foreground" title={q.fileName}>
                    {q.fileName}, {formatBytes(q.bytesTotal)}
                  </p>
                </div>
                <Badge variant="secondary">Waiting</Badge>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${q.title} from the queue`}
                  onClick={() => onRemove(q.key)}
                >
                  <X />
                </Button>
              </AnimatedItem>
            ))}
          </AnimatedList>
        </m.section>
      )}
    </AnimatePresence>
  );
}

function ServerInFlightRow({ asset }: { asset: VideoAsset }) {
  const job = useProcessingJob(asset.id, asset.status, true);
  const percent = job.data?.progressPercent ?? null;
  const stage = job.data ? (STAGE_LABEL[job.data.stage] ?? 'Processing') : 'Processing';
  return (
    <li className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <Link
            to={`/studio/assets/${asset.id}`}
            className="block truncate text-sm font-medium underline-offset-4 hover:underline"
            title={asset.title}
          >
            {asset.title}
          </Link>
          <p className="text-xs text-muted-foreground">
            {stage}
            {percent !== null && `, ${percent}%`}, uploaded {formatRelativeTime(asset.createdAt)}
          </p>
        </div>
        <Badge variant="warning">Processing</Badge>
      </div>
      <Progress
        value={percent ?? 0}
        aria-label={`${asset.title} processing progress`}
        className="[&>[data-slot=progress-indicator]]:duration-[2800ms]"
      />
    </li>
  );
}

/**
 * Uploads this page no longer tracks, for example after a reload, whose
 * processing is still running on the server.
 */
function ServerInFlight({ tracked }: { tracked: Set<string> }) {
  const list = useAssetList({ status: 'processing', limit: 6 });
  const rows = (list.data?.data ?? []).filter((a) => !tracked.has(a.id));
  if (rows.length === 0) return null;
  return (
    <m.section
      variants={fadeUp}
      initial="hidden"
      animate="visible"
      aria-labelledby="in-flight-title"
      className="flex flex-col gap-2"
    >
      <h2 id="in-flight-title" className="text-sm font-medium">
        Still processing
      </h2>
      <ul className="flex flex-col gap-2">
        {rows.map((a) => (
          <ServerInFlightRow key={a.id} asset={a} />
        ))}
      </ul>
    </m.section>
  );
}

export default function UploadPage({ store = defaultStore }: { store?: UploadStore }) {
  const { uploads, queued, queueHeld } = useUploads(store);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [rejected, setRejected] = useState<string | null>(null);
  const busy = uploads.some(isTransferring);
  const known = new Set(uploads.map((u) => u.uploadId).filter((id): id is string => !!id));
  const trackedAssets = new Set(uploads.map((u) => u.assetId).filter((id): id is string => !!id));
  const queryClient = useQueryClient();

  const unfinished = useQuery({
    queryKey: ['uploads', 'unfinished'],
    queryFn: findUnfinishedUploads,
    staleTime: 0,
  });
  // uploads this page is already showing have their own controls
  const unfinishedRows = (unfinished.data ?? []).filter((u) => !known.has(u.uploadId));

  /** Continue an unfinished upload with its file; returns why not, if it is the wrong file. */
  const resumeUnfinished = (u: UnfinishedUpload, file: File): string | null => {
    if (!isSameFile(u, file)) {
      return `${file.name} is not the file this upload started from. Choose ${u.fileName} (${formatBytes(u.size)}).`;
    }
    store.enqueue(file, { title: u.title, description: u.description, accessTier: u.accessTier });
    const percent = u.size > 0 ? Math.floor((u.offset / u.size) * 100) : 0;
    toast.success(
      busy
        ? `${u.title || u.fileName} will continue from ${percent}% after the current upload`
        : `Continuing ${u.title || u.fileName} from ${percent}%`,
    );
    void queryClient.invalidateQueries({ queryKey: ['uploads', 'unfinished'] });
    return null;
  };

  const choose = (files: File[]) => {
    const videos = files.filter(isVideo);
    const others = files.filter((f) => !isVideo(f));
    setRejected(
      others.length === 0
        ? null
        : others.length === 1
          ? `${others[0].name} is not a video file.`
          : `${others.length} files are not videos and were left out: ${others.map((f) => f.name).join(', ')}.`,
    );
    // a file that matches an unfinished upload picks up where it stopped,
    // with the details it was started with
    const fresh: File[] = [];
    for (const file of videos) {
      const match = unfinishedRows.find((u) => isSameFile(u, file));
      if (match) resumeUnfinished(match, file);
      else fresh.push(file);
    }
    if (fresh.length > 0) setDrafts((d) => [...d, ...fresh.map(toDraft)]);
  };

  const start = (opts: { description: string; accessTier: AccessTier }) => {
    const single = drafts.length === 1;
    for (const d of drafts) {
      store.enqueue(d.file, {
        title: d.title.trim(),
        description: single ? opts.description : undefined,
        accessTier: opts.accessTier,
      });
    }
    if (drafts.length > 1 || busy) {
      toast.success(
        busy
          ? `Queued ${plural(drafts.length, 'video')} after the current upload`
          : `Uploading ${plural(drafts.length, 'video')}, one after another`,
      );
    }
    setDrafts([]);
    setRejected(null);
  };

  return (
    <PageContainer>
      <PageHeader
        title="Upload"
        description="Videos are transcoded to adaptive HLS and stored on Sia"
      />
      <div className="flex flex-col gap-6">
        <Card className="max-w-2xl">
          <CardContent className="flex flex-col gap-4">
            {/* the new view fades in where the old one was; an exit here would
                overlap the two while the card changes height */}
            <m.div
              key={drafts.length > 0 ? 'form' : 'zone'}
              variants={fadeUp}
              initial="hidden"
              animate="visible"
            >
              {drafts.length > 0 ? (
                <DetailsForm
                  drafts={drafts}
                  busy={busy}
                  onChange={setDrafts}
                  onCancel={() => setDrafts([])}
                  onStart={start}
                />
              ) : (
                <DropZone onFiles={choose} busy={busy} />
              )}
            </m.div>
            {rejected && (
              <p role="alert" className="text-sm text-destructive">
                {rejected}
              </p>
            )}
            {drafts.length === 0 && (
              <UnfinishedUploads
                rows={unfinishedRows}
                error={unfinished.error}
                onResume={resumeUnfinished}
              />
            )}
          </CardContent>
        </Card>
        <QueuedList
          queued={queued}
          held={queueHeld}
          onRemove={(key) => store.removeQueued(key)}
          onContinue={() => store.continueQueue()}
        />
        <AnimatedList as="div" className="flex flex-col gap-6">
          {uploads.map((u) => (
            // slide only when a card comes or goes, not whenever something
            // above the list changes height (the form opening, the queue)
            <AnimatedItem key={u.key} as="div" layoutDependency={uploads.length}>
              <UploadCard store={store} s={u} busy={busy} />
            </AnimatedItem>
          ))}
        </AnimatedList>
        <ServerInFlight tracked={trackedAssets} />
      </div>
    </PageContainer>
  );
}
