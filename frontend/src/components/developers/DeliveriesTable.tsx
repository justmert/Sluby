import { Fragment, useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { ChevronDown, RotateCw } from 'lucide-react';
import { Collapse } from '@/components/motion';
import { CodeBlock } from '@/components/shared/CodeBlock';
import { InlineError } from '@/components/shared/InlineError';
import { HttpStatusBadge } from '@/components/shared/StatusBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ResponsiveCell, ResponsiveTable } from '@/components/ui/responsive-table';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useRedeliver, useWebhookDeliveries, type WebhookDelivery } from '@/hooks/useWebhooks';
import { withLead } from '@/lib/errors';
import { formatDate, formatRelativeTime } from '@/lib/formatters';
import { durationMs, highlight, lateReveal, listItem } from '@/lib/motion';
import { toastError, toastSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';

const MotionRow = m.create(TableRow);

/** A tint that fades out once, so a delivery that just arrived is easy to spot. */
function ArrivalFlash() {
  return (
    <m.span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 bg-primary/10"
      initial={{ opacity: 1 }}
      animate={{ opacity: 0 }}
      transition={highlight}
    />
  );
}

const fullTime = (iso: string) =>
  `${formatDate(iso)}, ${new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;

function DeliveryDetail({
  delivery: d,
  paused,
  onResend,
  resending,
}: {
  delivery: WebhookDelivery;
  paused: boolean;
  onResend: () => void;
  resending: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 py-3">
      {d.payload !== undefined && (
        <CodeBlock
          code={JSON.stringify(d.payload, null, 2)}
          language="json"
          label={`${d.event} payload`}
          preClassName="max-h-80"
        />
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Event ID</dt>
        <dd className="min-w-0 font-mono text-xs leading-5 break-all">{d.event_id ?? '–'}</dd>
        <dt className="text-muted-foreground">Error</dt>
        <dd className={cn('min-w-0 wrap-anywhere', d.error && 'text-destructive')}>
          {d.error ?? 'None'}
        </dd>
      </dl>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={onResend}
          disabled={paused || resending}
          aria-busy={resending || undefined}
          aria-describedby={paused ? `resend-paused-${d.id}` : undefined}
        >
          {resending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : <RotateCw />}
          {resending ? 'Resending…' : 'Resend'}
        </Button>
        {paused && (
          <p id={`resend-paused-${d.id}`} className="text-xs text-muted-foreground">
            Resume the webhook to resend.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * The delivery log of one webhook: newest first, refreshed every 10 seconds
 * while the tab is visible, new rows fading in with a short tint. Each row
 * opens to the payload that was sent and a Resend button (B-05, B-06).
 */
export function DeliveriesTable({ webhookId, paused }: { webhookId: string; paused: boolean }) {
  const deliveries = useWebhookDeliveries(webhookId);
  const redeliver = useRedeliver(webhookId);
  const rows = deliveries.data?.data;
  // open rows, and the rows still mounted while their detail collapses
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [mounted, setMounted] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);
  const toggle = (id: string) => {
    clearTimeout(timers.current.get(id));
    if (open.has(id)) {
      setOpen((s) => new Set([...s].filter((x) => x !== id)));
      timers.current.set(
        id,
        setTimeout(
          () => setMounted((s) => new Set([...s].filter((x) => x !== id))),
          durationMs.base,
        ),
      );
    } else {
      // mount closed first: Collapse does not animate its first render
      setMounted((s) => new Set(s).add(id));
      timers.current.set(
        id,
        setTimeout(() => setOpen((s) => new Set(s).add(id))),
      );
    }
  };
  const [resendingId, setResendingId] = useState<string | null>(null);
  // what was listed on the first load; anything after that is new
  const [known, setKnown] = useState<Set<string> | null>(null);
  if (known === null && rows) setKnown(new Set(rows.map((d) => d.id)));

  const resend = async (d: WebhookDelivery) => {
    setResendingId(d.id);
    try {
      await redeliver.mutateAsync(d.id);
      toastSuccess('Delivery queued');
    } catch (err) {
      toastError(withLead('Could not resend', err));
    } finally {
      setResendingId(null);
    }
  };

  if (!rows) {
    if (deliveries.isError) {
      return (
        <InlineError
          error={deliveries.error}
          title="Could not load deliveries"
          onRetry={() => deliveries.refetch()}
          retrying={deliveries.isFetching}
        />
      );
    }
    return (
      <div className="flex flex-col gap-2" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className={cn('h-10', lateReveal)} />
        ))}
      </div>
    );
  }

  return (
    <section aria-label="Recent deliveries" className="flex flex-col gap-3">
      {deliveries.isError && (
        <InlineError
          error={deliveries.error}
          title="Could not refresh deliveries"
          onRetry={() => deliveries.refetch()}
          retrying={deliveries.isFetching}
        />
      )}
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
          No deliveries yet.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border bg-card">
          <ResponsiveTable aria-label="Deliveries" className="max-sm:[&_tbody>tr]:px-4">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Status</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>Attempt</TableHead>
                <TableHead>Time</TableHead>
                <TableHead className="w-12 pr-4">
                  <span className="sr-only">Details</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <AnimatePresence initial={false}>
                {rows.map((d) => {
                  const isOpen = open.has(d.id);
                  const fresh = known !== null && !known.has(d.id);
                  const panelId = `delivery-${d.id}`;
                  return (
                    <Fragment key={d.id}>
                      <MotionRow
                        variants={listItem}
                        initial="hidden"
                        animate="visible"
                        exit="exit"
                        className="relative"
                      >
                        <ResponsiveCell cell="primary" className="pl-4">
                          {fresh && <ArrivalFlash />}
                          <span className="relative flex flex-wrap items-center gap-1.5">
                            <HttpStatusBadge code={d.status_code} />
                            {d.manual && <Badge variant="outline">Resent</Badge>}
                          </span>
                        </ResponsiveCell>
                        <ResponsiveCell label="Event" className="font-mono text-xs">
                          {d.event}
                        </ResponsiveCell>
                        <ResponsiveCell label="Attempt" className="tabular-nums">
                          {d.attempt}
                        </ResponsiveCell>
                        <ResponsiveCell label="Time" className="text-muted-foreground">
                          <time dateTime={d.created_at} title={fullTime(d.created_at)}>
                            {formatRelativeTime(d.created_at)}
                          </time>
                        </ResponsiveCell>
                        <ResponsiveCell cell="actions" className="pr-4 text-right">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-expanded={isOpen}
                            aria-controls={panelId}
                            aria-label={`Details for ${d.event}, ${formatRelativeTime(d.created_at)}`}
                            onClick={() => toggle(d.id)}
                          >
                            <ChevronDown
                              aria-hidden="true"
                              className={cn(
                                'transition-transform duration-200 ease-out-soft',
                                isOpen && 'rotate-180',
                              )}
                            />
                          </Button>
                        </ResponsiveCell>
                      </MotionRow>
                      {mounted.has(d.id) && (
                        <TableRow className="hover:bg-transparent max-sm:py-0">
                          <TableCell
                            colSpan={5}
                            className="px-4 py-0 whitespace-normal max-sm:[grid-column:1/-1]!"
                          >
                            <Collapse open={isOpen} id={panelId}>
                              <DeliveryDetail
                                delivery={d}
                                paused={paused}
                                onResend={() => void resend(d)}
                                resending={resendingId === d.id}
                              />
                            </Collapse>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </AnimatePresence>
            </TableBody>
          </ResponsiveTable>
        </div>
      )}
    </section>
  );
}
