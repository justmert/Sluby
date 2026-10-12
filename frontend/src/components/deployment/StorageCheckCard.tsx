import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { CopyButton } from '@/components/shared/CopyButton';
import { ErrorDetails } from '@/components/shared/ErrorDetails';
import { InlineError } from '@/components/shared/InlineError';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import {
  useReconciliation,
  useRunReconciliation,
  type DeploymentReconciliation,
} from '@/hooks/useStats';
import { withLead } from '@/lib/errors';
import { ROUTES } from '@/lib/constants';
import { formatCount, plural, truncateMiddle } from '@/lib/formatters';
import { lateReveal } from '@/lib/motion';
import { toastError, toastSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { shortAgo, shortDuration, useNow, type Tone } from './health';
import { ACCENT_LINK, Panel, ToneChip } from './parts';

const ID = 'health-storage-check';
const TITLE = 'Storage check';
const ABOUT = 'Compares your videos with what Sia holds.';

const VERDICT: Record<DeploymentReconciliation['status'], { label: string; tone: Tone }> = {
  ok: { label: 'All present', tone: 'ok' },
  drift: { label: 'Needs attention', tone: 'warn' },
  failed: { label: 'Check failed', tone: 'bad' },
};

export function CheckNowButton({
  onClick,
  pending = false,
  disabled = false,
}: {
  onClick?: () => void;
  pending?: boolean;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="outline"
      className="h-8 pointer-coarse:h-10"
      onClick={onClick}
      disabled={disabled || pending}
    >
      {pending && <Spinner data-icon="inline-start" aria-hidden="true" />}
      Check now
    </Button>
  );
}

/** A count in a bordered tile; the edge turns to the tone when the count is not zero. */
function Tile({ value, label, tone }: { value: number; label: string; tone: 'warn' | 'bad' }) {
  const on = value > 0;
  return (
    <div
      data-slot="check-tile"
      data-tone={on ? tone : undefined}
      className={cn(
        'rounded-[10px] border p-3',
        on && tone === 'warn' && 'border-warning/60',
        on && tone === 'bad' && 'border-destructive/40',
      )}
    >
      <div
        className={cn(
          'text-[22px] leading-7 font-bold tabular-nums',
          on && tone === 'warn' && 'text-warning-foreground',
          on && tone === 'bad' && 'text-destructive',
        )}
      >
        {formatCount(value)}
      </div>
      <div className="text-muted-foreground">{label}</div>
    </div>
  );
}

/** A native disclosure: the summary in the accent, the list under it. */
function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group/disclosure">
      <summary className={cn(ACCENT_LINK, 'w-fit cursor-pointer')}>{summary}</summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

// a scroller with nothing focusable inside: Safari can scroll it from the
// keyboard only if the list itself takes focus
const LIST =
  'max-h-60 overflow-y-auto rounded-sm pl-4.5 font-mono text-xs leading-5 text-secondary-foreground list-disc';

/** File IDs, one per line, shortened; the whole set copies in one go. */
function IdList({ label, ids }: { label: string; ids: string[] }) {
  return (
    <div className="flex items-start gap-2">
      <ul aria-label={label} tabIndex={0} className={cn(LIST, 'min-w-0 flex-1')}>
        {ids.map((id) => (
          <li key={id} title={id}>
            {truncateMiddle(id, 8)}
          </li>
        ))}
      </ul>
      <CopyButton value={ids.join('\n')} label={`Copy ${label.toLowerCase()} IDs`} />
    </div>
  );
}

type MissingObject = DeploymentReconciliation['missing_objects'][number];

/**
 * Missing files grouped under the video that uses them, so the reader can go
 * to the video that may not play. Files no video claims come last.
 */
function MissingList({ objects }: { objects: MissingObject[] }) {
  const groups = new Map<string | null, { title: string | null; ids: string[] }>();
  for (const o of objects) {
    const group = groups.get(o.video_asset_id) ?? { title: o.title, ids: [] };
    group.ids.push(o.object_id);
    groups.set(o.video_asset_id, group);
  }
  const ordered = [...groups].sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : 0));
  return (
    <div className="flex items-start gap-2">
      <ul
        aria-label="Missing files"
        tabIndex={0}
        className="flex max-h-60 min-w-0 flex-1 flex-col gap-2 overflow-y-auto rounded-sm text-xs"
      >
        {ordered.map(([videoId, g]) => (
          <li key={videoId ?? 'none'} className="flex flex-col gap-0.5">
            <span className="flex flex-wrap items-baseline gap-x-2">
              {videoId ? (
                <Link to={ROUTES.video(videoId)} dir="auto" className={ACCENT_LINK}>
                  {g.title || 'Untitled video'}
                </Link>
              ) : (
                <span className="font-semibold">Video not found</span>
              )}
              <span className="text-muted-foreground">{plural(g.ids.length, 'file')}</span>
            </span>
            <span className="font-mono leading-5 break-all text-secondary-foreground">
              {g.ids.join(' ')}
            </span>
          </li>
        ))}
      </ul>
      <CopyButton
        value={objects.map((o) => o.object_id).join('\n')}
        label="Copy missing file IDs"
      />
    </div>
  );
}

/** The card's body before the result is in, at the height of a finished check. */
export function CheckLoading() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3">
      <div className="flex h-5.5 items-center">
        <Skeleton className={cn('h-3.5 w-4/5', lateReveal)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-col gap-1.5 rounded-[10px] border p-3">
            <Skeleton className={cn('h-6 w-8', lateReveal)} />
            <Skeleton className={cn('h-3.5 w-24', lateReveal)} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The card as the page first draws it, before the check result is in. */
export function StorageCheckLoading() {
  return (
    <Panel id={ID} title={TITLE} action={<CheckNowButton disabled />}>
      <CheckLoading />
    </Panel>
  );
}

function RunLine({ run }: { run: DeploymentReconciliation }) {
  const now = useNow(15_000);
  const took = Date.parse(run.finished_at) - Date.parse(run.started_at);
  return (
    <p className="text-muted-foreground">
      {ABOUT} Last run{' '}
      <time dateTime={run.finished_at} title={new Date(run.finished_at).toLocaleString()}>
        {shortAgo(now - Date.parse(run.finished_at))}
      </time>
      {Number.isFinite(took) && `, took ${shortDuration(took)}`}.
      {run.status !== 'failed' &&
        ` It compared ${plural(run.db_object_count, 'known file')} with ${plural(run.indexer_object_count, 'file')} on Sia.`}
    </p>
  );
}

/** The latest storage check over every account, with a way to start one. */
export function StorageCheckCard() {
  const run = useReconciliation();
  const start = useRunReconciliation();
  const r = run.data?.scope === 'deployment' ? run.data : null;

  const checkNow = async () => {
    try {
      const enqueued = await start.mutateAsync();
      toastSuccess(enqueued ? 'Storage check started' : 'A check is already running');
    } catch (err) {
      toastError(withLead('Could not start the storage check', err));
    }
  };

  const verdict = r ? VERDICT[r.status] : null;
  return (
    <Panel
      id={ID}
      title={TITLE}
      note={verdict && <ToneChip tone={verdict.tone}>{verdict.label}</ToneChip>}
      action={<CheckNowButton onClick={() => void checkNow()} pending={start.isPending} />}
      className="gap-3"
    >
      {run.isPending ? (
        <CheckLoading />
      ) : run.isError && !run.data ? (
        <InlineError
          what="the storage check"
          error={run.error}
          onRetry={() => void run.refetch()}
          retrying={run.isFetching}
        />
      ) : !r ? (
        <p className="text-muted-foreground">
          {ABOUT} No check has run yet. Start one to compare every video&apos;s files with Sia.
        </p>
      ) : (
        <>
          <RunLine run={r} />
          {r.status === 'failed' ? (
            <div>
              <p>The check stopped before it finished. Start it again.</p>
              <ErrorDetails detail={r.error_message ?? undefined} className="mt-1.5" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Tile value={r.missing_count} label="missing files" tone="bad" />
                <Tile value={r.orphan_count} label="unused files still stored" tone="warn" />
              </div>
              {r.missing_objects.length > 0 && (
                <Disclosure summary="Show missing files">
                  <MissingList objects={r.missing_objects} />
                </Disclosure>
              )}
              {r.orphaned_ids.length > 0 && (
                <Disclosure summary="Show unused files">
                  <IdList label="Unused files" ids={r.orphaned_ids} />
                </Disclosure>
              )}
            </>
          )}
          {run.isError && (
            <InlineError
              title="The check result is out of date"
              error={run.error}
              onRetry={() => void run.refetch()}
              retrying={run.isFetching}
            />
          )}
        </>
      )}
    </Panel>
  );
}
