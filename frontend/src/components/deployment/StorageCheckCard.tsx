import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { Collapse } from '@/components/motion';
import { ErrorDetails } from '@/components/shared/ErrorDetails';
import { InlineError } from '@/components/shared/InlineError';
import { StatusBadge } from '@/components/shared/StatusBadge';
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
import { formatCount, formatRelativeTime, plural } from '@/lib/formatters';
import { Icons } from '@/lib/icons';
import { lateReveal } from '@/lib/motion';
import { toastError, toastSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { HealthCard } from './parts';

const TITLE = 'Storage check';
const DESCRIPTION = "Confirms every video's files are still on Sia";

/** The card as the page first draws it, before the check result is in. */
export function StorageCheckLoading() {
  return (
    <HealthCard title={TITLE} description={DESCRIPTION} action={<CheckNowButton disabled />}>
      <CheckLoading />
    </HealthCard>
  );
}

/** What the latest run found, in a sentence; the figures above it give the counts. */
function verdict(run: DeploymentReconciliation): string {
  if (run.missing_count > 0) {
    return `${plural(run.missing_count, 'file is', 'files are')} missing from Sia. Videos that use them may not play.`;
  }
  if (run.orphan_count > 0) {
    return `Nothing is missing. Sia holds ${plural(run.orphan_count, 'file')} no video uses, usually left by an interrupted upload. They use storage but break nothing.`;
  }
  return 'Every file the videos use is on Sia.';
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-heading text-figure-sm tabular-nums">{value}</dd>
    </div>
  );
}

/** A button that shows or hides what it is given under it. */
function Disclosure({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (count === 0) return null;
  return (
    <div>
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronRight
          aria-hidden="true"
          className={cn('transition-transform duration-150', open && 'rotate-90')}
        />
        {open ? 'Hide' : 'Show'} {label} ({formatCount(count)})
      </Button>
      <Collapse open={open} id={id}>
        {children}
      </Collapse>
    </div>
  );
}

const LIST =
  'mt-1 max-h-60 overflow-y-auto rounded-lg border bg-muted/40 p-2 text-xs text-muted-foreground';
const IDS = 'font-mono break-all';

/** File IDs, one per line. */
function IdList({ label, ids }: { label: string; ids: string[] }) {
  return (
    <Disclosure label={label} count={ids.length}>
      <ul aria-label={label.charAt(0).toUpperCase() + label.slice(1)} className={cn(LIST, IDS)}>
        {ids.map((x) => (
          <li key={x} className="py-0.5">
            {x}
          </li>
        ))}
      </ul>
    </Disclosure>
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
    <Disclosure label="missing files" count={objects.length}>
      <ul aria-label="Missing files" className={cn(LIST, 'flex flex-col gap-2')}>
        {ordered.map(([videoId, g]) => (
          <li key={videoId ?? 'none'} className="flex flex-col gap-0.5">
            <span className="flex flex-wrap items-baseline gap-x-2">
              {videoId ? (
                <Link
                  to={ROUTES.video(videoId)}
                  dir="auto"
                  className="font-medium text-foreground underline-offset-2 hover:underline"
                >
                  {g.title || 'Untitled video'}
                </Link>
              ) : (
                <span className="font-medium text-foreground">Video not found</span>
              )}
              <span>{plural(g.ids.length, 'file')}</span>
            </span>
            <span className={IDS}>{g.ids.join(' ')}</span>
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}

export function CheckLoading() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4">
      <div className="flex h-5.5 items-center justify-between gap-4">
        <Skeleton className={cn('h-5.5 w-28 rounded-full', lateReveal)} />
        <Skeleton className={cn('h-3.5 w-32', lateReveal)} />
      </div>
      <div className="grid grid-cols-2 gap-4 @2xl/page:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex flex-col gap-1">
            <Skeleton className={cn('h-4 w-20', lateReveal)} />
            <Skeleton className={cn('h-7 w-12', lateReveal)} />
          </div>
        ))}
      </div>
      <Skeleton className={cn('h-4 w-3/4', lateReveal)} />
    </div>
  );
}

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
    <Button variant="outline" size="sm" onClick={onClick} disabled={disabled || pending}>
      {pending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : <Icons.refresh />}
      Check now
    </Button>
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

  return (
    <HealthCard
      title={TITLE}
      description={DESCRIPTION}
      action={<CheckNowButton onClick={() => void checkNow()} pending={start.isPending} />}
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
        <p className="text-sm text-muted-foreground">
          No check has run yet. Start one to compare every video&apos;s files with Sia.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <StatusBadge kind="check" status={r.status} />
            <span className="text-sm text-muted-foreground">
              Checked {formatRelativeTime(r.finished_at)}
            </span>
          </div>
          {r.status === 'failed' ? (
            <div className="text-sm">
              <p>The check stopped before it finished. Start it again.</p>
              <ErrorDetails detail={r.error_message ?? undefined} className="mt-1.5" />
            </div>
          ) : (
            <>
              <dl className="grid grid-cols-2 gap-4 @2xl/page:grid-cols-4">
                <Figure label="Present" value={formatCount(r.in_sync_count)} />
                <Figure label="Missing from Sia" value={formatCount(r.missing_count)} />
                <Figure label="Unused files on Sia" value={formatCount(r.orphan_count)} />
                <Figure label="Files on Sia" value={formatCount(r.indexer_object_count)} />
              </dl>
              <p className="text-sm text-muted-foreground">
                {verdict(r)} Compared {plural(r.db_object_count, 'known file')} with{' '}
                {plural(r.indexer_object_count, 'file')} on Sia.
              </p>
              {(r.missing_ids.length > 0 || r.orphaned_ids.length > 0) && (
                <div className="flex flex-col gap-1">
                  <MissingList objects={r.missing_objects} />
                  <IdList label="unused files on Sia" ids={r.orphaned_ids} />
                </div>
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
        </div>
      )}
    </HealthCard>
  );
}
