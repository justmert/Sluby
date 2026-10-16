import { useId, useState } from 'react';
import { Link } from 'react-router';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { Check, ChevronDown, RotateCcw, X } from 'lucide-react';
import { PipelineSteps } from '@/components/asset/PipelineSteps';
import { uploadSteps } from '@/components/asset/pipeline-states';
import { failureInfo, stageLabel } from '@/components/asset/processing';
import { RetryProcessingButton } from '@/components/asset/RetryProcessingButton';
import { Collapse } from '@/components/motion';
import { CopyButton } from '@/components/shared/CopyButton';
import { ErrorDetails } from '@/components/shared/ErrorDetails';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { ROUTES } from '@/lib/constants';
import { primaryEmbed } from '@/lib/embed';
import { Icons } from '@/lib/icons';
import { highlight } from '@/lib/motion';
import { CHUNK_SIZE, isTransferring, type UploadState, type UploadStore } from '@/lib/upload-store';
import { cn } from '@/lib/utils';
import { ChunkStrip } from './ChunkStrip';
import { rowTitleId } from './ids';
import { badgeStatus, statusLine } from './upload-status';

const ButtonSpinner = () => <Spinner role={undefined} aria-hidden="true" />;

// the board's row buttons are 30px, a step under the page's 36px buttons
const SMALL = 'h-7.5 gap-1.5 px-2.5 text-sm pointer-coarse:h-9';

/** A bar with no number yet: a slow sweep, or a still fill under reduced motion (MOT-06). */
function WaitingBar({ label }: { label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuetext="Waiting"
      className="relative h-1.5 overflow-hidden rounded-full bg-sunken before:absolute before:inset-y-0 before:w-1/3 before:-translate-x-full before:rounded-full before:bg-progress/60 motion-safe:before:animate-shimmer motion-reduce:before:w-full motion-reduce:before:translate-x-0 motion-reduce:before:bg-progress/30"
    />
  );
}

/**
 * A ring that lights up once and fades when an upload lands on ready or
 * failed, with the shared "this just happened" timing (MOT-11). Rows that
 * were already settled when the page opened do not flash.
 */
function SettleFlash({ phase }: { phase: UploadState['phase'] | null }) {
  const tone = phase === 'ready' ? 'ring-success' : phase === 'failed' ? 'ring-destructive' : null;
  return (
    <AnimatePresence initial={false}>
      {tone && (
        <m.span
          key={phase}
          aria-hidden="true"
          className={cn('pointer-events-none absolute inset-0 ring-2 ring-inset', tone)}
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={highlight}
        />
      )}
    </AnimatePresence>
  );
}

function JobLog({ s }: { s: UploadState }) {
  const logs = s.job?.logs ?? [];
  if (logs.length === 0) return null;
  const failedAt = s.phase === 'failed' && s.failedDuring === 'processing' ? logs.length - 1 : -1;
  return (
    <div
      role="region"
      aria-label="Processing log"
      tabIndex={0}
      className="max-h-48 overflow-y-auto rounded-lg bg-muted/50 p-3 font-mono text-xs outline-none focus-visible:ring-3 focus-visible:ring-ring"
    >
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 @md/upload:grid-cols-[auto_auto_1fr]">
        {logs.map((line, i) => (
          <div key={i} className="contents">
            <span className="text-muted-foreground tabular-nums">
              {new Date(line.timestamp).toLocaleTimeString()}
            </span>
            <span className="text-muted-foreground">{stageLabel(line.stage)}</span>
            <span
              className={cn(
                'col-span-2 wrap-anywhere @md/upload:col-span-1',
                i === failedAt && 'text-destructive',
              )}
            >
              {line.message}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export interface UploadRowProps {
  store: UploadStore;
  upload: UploadState;
  /** another upload transfers now, so this one cannot resume yet */
  busy: boolean;
  /** pick a different file after a failure processing cannot fix */
  onReupload: () => void;
}

/**
 * One upload in the upload page's file list: title, the phase badge, one status line, a bar
 * while there is a number, and the actions that fit the phase. Details
 * (processing steps, the parts sent, the log) open below.
 */
export function UploadRow({ store, upload: s, busy, onReupload }: UploadRowProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<'pause' | 'cleanup' | null>(null);
  const status = statusLine(s);
  const assetLink = s.assetId && !s.assetGone && s.cleanup !== 'done' ? s.assetId : null;
  const dismissable = !isTransferring(s) && s.cleanup !== 'pending';
  const info =
    s.phase === 'failed' && s.failedDuring === 'processing'
      ? failureInfo(s.job ?? undefined)
      : null;
  const detail = info?.detail ?? s.errorDetail;
  const showChunks = isTransferring(s) && Math.ceil(s.bytesTotal / CHUNK_SIZE) > 1;
  // a running transfer shows its bar, line and buttons only, like the board;
  // the steps, parts sent and log open once it pauses, processes or stops
  const hasDetails =
    s.phase !== 'uploading' && s.phase !== 'finishing' && (s.phase !== 'cancelled' || !!detail);

  const run = async (kind: 'pause' | 'cleanup', action: () => Promise<void>) => {
    setPending(kind);
    try {
      await action();
    } finally {
      setPending(null);
    }
  };

  const actions: React.ReactNode[] = [];
  if (s.phase === 'uploading' || s.phase === 'paused') {
    actions.push(
      s.phase === 'uploading' ? (
        <Button
          key="pause"
          variant="outline"
          className={SMALL}
          disabled={pending === 'pause'}
          onClick={() => void run('pause', () => store.pause(s.key))}
        >
          {pending === 'pause' && <ButtonSpinner />}
          {pending === 'pause' ? 'Pausing…' : 'Pause'}
        </Button>
      ) : (
        <Button key="resume" className={SMALL} onClick={() => store.resume(s.key)}>
          Resume
        </Button>
      ),
      <Button
        key="cancel"
        variant="outline"
        className={SMALL}
        onClick={() => void store.cancel(s.key)}
      >
        Cancel
      </Button>,
    );
  }
  if (s.phase === 'processing' && s.pollStopped && !s.authFailed) {
    actions.push(
      <Button key="check" variant="outline" className={SMALL} onClick={() => store.refresh(s.key)}>
        <Icons.refresh />
        Check again
      </Button>,
    );
  }
  // a transfer that failed left an empty video behind; there is nothing to open yet
  if (
    (s.phase === 'processing' || (s.phase === 'failed' && s.failedDuring !== 'upload')) &&
    assetLink
  ) {
    actions.push(
      <Button key="open" variant="outline" className={SMALL} asChild>
        <Link to={ROUTES.video(assetLink)}>Open video</Link>
      </Button>,
    );
  }
  if (s.phase === 'failed' && s.failedDuring === 'upload' && s.canResume) {
    actions.push(
      <Button
        key="resume-upload"
        className={SMALL}
        disabled={busy}
        aria-describedby={busy ? `${id}-busy` : undefined}
        onClick={() => store.resumeTransfer(s.key)}
      >
        Resume upload
      </Button>,
    );
  }
  if (info && !s.assetGone && !s.authFailed) {
    if (info.action === 'retry') {
      actions.push(
        <RetryProcessingButton
          key="retry"
          size="sm"
          className={SMALL}
          asset={{ id: s.assetId!, title: s.title }}
          // through the store, so this row follows the new run; the row shows how it went
          onRetry={() => store.retryProcessing(s.key)}
        />,
      );
    } else if (info.action === 'reupload') {
      actions.push(
        <Button key="reupload" className={SMALL} onClick={onReupload}>
          Upload a different file
        </Button>,
      );
    }
  }
  if (s.phase === 'cancelled' && s.cleanup === 'failed' && s.uploadId && !s.authFailed) {
    actions.push(
      <Button
        key="cleanup"
        variant="outline"
        className={SMALL}
        disabled={pending === 'cleanup'}
        onClick={() => void run('cleanup', () => store.retryCleanup(s.key))}
      >
        {pending === 'cleanup' ? <ButtonSpinner /> : <RotateCcw />}
        Try again
      </Button>,
    );
  }

  const dismiss = dismissable && (
    <Button
      variant="ghost"
      size="icon-xs"
      className="-mr-1 shrink-0 text-muted-foreground"
      aria-label={`Dismiss ${s.title}`}
      onClick={() => store.dismiss(s.key)}
    >
      <X />
    </Button>
  );

  // a finished upload is one line: a check, the title as a link to the
  // video, and the embed code, which is what people come back here for
  if (s.phase === 'ready' && assetLink) {
    return (
      <div
        className="relative flex items-center gap-2.5 px-4.5 py-3.5"
        data-testid="upload-row"
        data-phase={s.phase}
      >
        <SettleFlash phase={s.phase} />
        <Check className="size-4.5 shrink-0 text-success" strokeWidth={2.2} aria-hidden="true" />
        <h3
          id={rowTitleId(s.key)}
          tabIndex={-1}
          className="min-w-0 flex-1 truncate rounded-sm text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring"
        >
          <Link
            to={ROUTES.video(assetLink)}
            dir="auto"
            title={`${s.title}, ${status.text}`}
            className="text-foreground underline-offset-4 hover:underline"
          >
            {s.title}
          </Link>
        </h3>
        <span className="sr-only">Ready.</span>
        <CopyButton
          value={primaryEmbed({ id: assetLink, accessTier: s.accessTier }).code}
          label="Copy embed code"
          text="Copy embed code"
          withText
          variant="outline"
          className={SMALL}
        />
        {dismiss}
      </div>
    );
  }

  return (
    <div
      className="relative flex flex-col gap-2 px-4.5 py-3.5"
      data-testid="upload-row"
      data-phase={s.phase}
    >
      <SettleFlash phase={s.assetGone ? null : s.phase} />
      <div className="flex items-center gap-2.5">
        <h3
          id={rowTitleId(s.key)}
          tabIndex={-1}
          dir="auto"
          title={`${s.title} (${s.fileName})`}
          className="min-w-0 flex-1 truncate rounded-sm text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring"
        >
          {s.title}
        </h3>
        <StatusBadge kind="upload" status={badgeStatus(s)} className="shrink-0" />
        {dismiss}
      </div>

      {status.bar === 'waiting' ? (
        <WaitingBar label={`${s.title}, progress`} />
      ) : status.bar !== null ? (
        <Progress
          value={status.bar}
          smooth={s.phase === 'processing'}
          moving={s.phase === 'uploading' || s.phase === 'processing'}
          className="h-1.5 bg-sunken"
          aria-label={
            s.phase === 'processing' ? `${s.title}, processing progress` : `${s.title} upload`
          }
        />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <p
          className={cn(
            'min-w-0 flex-1 basis-48 text-sm tabular-nums',
            status.tone === 'danger' ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {s.phase === 'cancelled' && s.cleanup === 'failed' && (
            <span className="font-medium">Upload stopped but not cleaned up. </span>
          )}
          {status.text}
        </p>
        {hasDetails && (
          <Button
            variant="ghost"
            className={cn(SMALL, 'text-muted-foreground')}
            aria-expanded={open}
            aria-controls={`${id}-details`}
            onClick={() => setOpen((o) => !o)}
          >
            <ChevronDown
              className={cn('transition-transform duration-200 ease-design', open && 'rotate-180')}
            />
            {open ? 'Hide details' : 'Details'}
          </Button>
        )}
        {/* the buttons wrap as one group, so a narrow row never splits them */}
        {actions.length > 0 && <div className="ml-auto flex shrink-0 gap-2">{actions}</div>}
      </div>
      {status.detail && <p className="text-xs text-muted-foreground">{status.detail}</p>}
      {s.notice && <p className="text-xs text-muted-foreground">{s.notice}</p>}
      {busy && s.phase === 'failed' && s.canResume && (
        <p id={`${id}-busy`} className="text-xs text-muted-foreground">
          Another upload is running. Wait for it to finish.
        </p>
      )}

      <Collapse open={open} id={`${id}-details`} className="flex flex-col gap-4 pt-2">
        {/* across, like the video page's processing card; capped so the
            rails stay short in a wide row */}
        <PipelineSteps steps={uploadSteps(s)} size="sm" className="max-w-xl" />
        {showChunks && (
          <ChunkStrip
            bytesUploaded={s.bytesUploaded}
            bytesTotal={s.bytesTotal}
            chunkSize={CHUNK_SIZE}
            active={false}
          />
        )}
        <JobLog s={s} />
        <ErrorDetails detail={detail ?? undefined} />
      </Collapse>
    </div>
  );
}
