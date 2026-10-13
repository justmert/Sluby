import { Fragment, useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { Collapse } from '@/components/motion';
import { InlineError } from '@/components/shared/InlineError';
import { JsonViewer } from '@/components/shared/JsonViewer';
import { httpSpec } from '@/components/shared/status';
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

const PAUSED_NOTE_ID = 'deliveries-paused-note';

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

const TONE_VARIANT = {
  success: 'success',
  warning: 'warning',
  danger: 'destructive',
} as const;

/**
 * "200", "503 · after 3 tries", "No answer". the log has no response time,
 * so the chip carries the code and, for a retry, which try this was.
 */
export function ResultChip({ delivery: d }: { delivery: WebhookDelivery }) {
  const spec = httpSpec(d.statusCode);
  // a 2xx the receiver answered too late or malformed still counts as not delivered
  const tone = d.delivered ? 'success' : spec.tone === 'success' ? 'danger' : spec.tone;
  const code = d.statusCode == null ? 'No answer' : String(d.statusCode);
  const tries =
    d.attempt > 1 ? (d.delivered ? ` · try ${d.attempt}` : ` · after ${d.attempt} tries`) : '';
  return (
    <Badge
      variant={TONE_VARIANT[tone as keyof typeof TONE_VARIANT] ?? 'secondary'}
      className="tabular-nums"
    >
      {code}
      {tries}
    </Badge>
  );
}

function SendAgain({
  delivery: d,
  paused,
  resending,
  onResend,
}: {
  delivery: WebhookDelivery;
  paused: boolean;
  resending: boolean;
  onResend: () => void;
}) {
  return (
    <Button
      variant="outline"
      className="h-7.5 px-2.5"
      onClick={onResend}
      disabled={paused || resending}
      aria-busy={resending || undefined}
      aria-describedby={paused ? PAUSED_NOTE_ID : undefined}
      // a label, not an sr-only span: chrome puts a space before the span's comma
      aria-label={`${resending ? 'Sending…' : 'Send again'}, ${d.event}, ${formatRelativeTime(d.createdAt)}`}
    >
      {resending && <Spinner data-icon="inline-start" aria-hidden="true" />}
      {resending ? 'Sending…' : 'Send again'}
    </Button>
  );
}

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
    <div className="flex flex-col gap-3 pb-4">
      <JsonViewer
        value={d.payload}
        label="Payload"
        name={`${d.event} payload`}
        bodyClassName="max-h-80"
      />
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">Event ID</dt>
        <dd className="min-w-0 font-mono text-[13px] leading-5 break-all">{d.eventId ?? '–'}</dd>
        <dt className="text-muted-foreground">Error</dt>
        <dd className={cn('min-w-0 wrap-anywhere', d.error && 'text-destructive')}>
          {d.error ?? 'None'}
        </dd>
      </dl>
      {/* a failed row has Send again on the row itself */}
      {d.delivered && (
        <div>
          <SendAgain delivery={d} paused={paused} resending={resending} onResend={onResend} />
        </div>
      )}
    </div>
  );
}

/**
 * The delivery log of one webhook as a card: newest first, refreshed every
 * 10 seconds while the tab is visible, new rows fading in with a short tint.
 * Each row shows its payload on demand, and a failed one can be sent again
 * (B-05, B-06).
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

  let body: React.ReactNode;
  if (!rows) {
    body = deliveries.isError ? (
      <div className="px-5 pb-4">
        <InlineError
          error={deliveries.error}
          title="Could not load deliveries"
          onRetry={() => deliveries.refetch()}
          retrying={deliveries.isFetching}
        />
      </div>
    ) : (
      <div className="flex flex-col gap-2 px-5 pb-4" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className={cn('h-10', lateReveal)} />
        ))}
      </div>
    );
  } else if (rows.length === 0) {
    body = (
      <p className="border-t px-5 py-8 text-center text-sm text-muted-foreground">
        No deliveries yet.
      </p>
    );
  } else {
    body = (
      <ResponsiveTable aria-label="Deliveries" className="max-sm:[&_tbody>tr]:px-5">
        <TableHeader className="[&_tr]:border-y [&_tr]:bg-background [&_tr]:hover:bg-background">
          <TableRow>
            <TableHead className="h-auto px-3 py-2.5 pl-5 font-semibold">Event</TableHead>
            <TableHead className="h-auto px-3 py-2.5 font-semibold">Result</TableHead>
            <TableHead className="h-auto px-3 py-2.5 font-semibold">Sent</TableHead>
            <TableHead className="h-auto px-3 py-2.5 pr-5 text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <AnimatePresence initial={false}>
            {rows.map((d) => {
              const isOpen = open.has(d.id);
              const fresh = known !== null && !known.has(d.id);
              const panelId = `delivery-${d.id}`;
              const when = formatRelativeTime(d.createdAt);
              return (
                <Fragment key={d.id}>
                  <MotionRow
                    variants={listItem}
                    initial="hidden"
                    animate="visible"
                    exit="exit"
                    className="relative border-b-0 not-first:border-t hover:bg-background has-aria-expanded:bg-muted"
                  >
                    <ResponsiveCell cell="primary" className="px-3 py-2.5 pl-5">
                      {fresh && <ArrivalFlash />}
                      <span className="relative flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-[13px]">{d.event}</span>
                        {d.event === 'webhook.test' && <Badge variant="secondary">Test</Badge>}
                        {d.manual && <Badge variant="secondary">Resent</Badge>}
                      </span>
                    </ResponsiveCell>
                    <ResponsiveCell label="Result" className="px-3 py-2.5">
                      <ResultChip delivery={d} />
                    </ResponsiveCell>
                    <ResponsiveCell label="Sent" className="px-3 py-2.5 text-muted-foreground">
                      <time dateTime={d.createdAt} title={fullTime(d.createdAt)}>
                        {when}
                      </time>
                    </ResponsiveCell>
                    <ResponsiveCell cell="actions" className="px-3 py-2.5 pr-5 text-right">
                      <span className="inline-flex flex-wrap justify-end gap-2">
                        {!d.delivered && (
                          <SendAgain
                            delivery={d}
                            paused={paused}
                            resending={resendingId === d.id}
                            onResend={() => void resend(d)}
                          />
                        )}
                        <Button
                          variant="outline"
                          className="h-7.5 px-2.5"
                          aria-expanded={isOpen}
                          aria-controls={panelId}
                          onClick={() => toggle(d.id)}
                          aria-label={`${isOpen ? 'Hide payload' : 'Show payload'}, ${d.event}, ${when}`}
                        >
                          {isOpen ? 'Hide payload' : 'Show payload'}
                        </Button>
                      </span>
                    </ResponsiveCell>
                  </MotionRow>
                  {mounted.has(d.id) && (
                    <TableRow className="border-b-0 hover:bg-transparent max-sm:py-0">
                      <TableCell
                        colSpan={4}
                        className="px-5 py-0 whitespace-normal max-sm:[grid-column:1/-1]!"
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
    );
  }

  return (
    <section
      aria-labelledby="deliveries-title"
      className="min-w-0 flex-[999_1_35rem] overflow-hidden rounded-xl border bg-card text-sm"
    >
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 px-5 py-4">
        <h2 id="deliveries-title" className="font-heading text-heading">
          Deliveries
        </h2>
        {/* the log holds the latest attempts, newest first, not a fixed time window */}
        <span className="text-sm text-muted-foreground">Newest first</span>
      </div>
      {paused && (
        <p id={PAUSED_NOTE_ID} className="-mt-2 px-5 pb-3 text-sm text-muted-foreground">
          Resume the webhook to send deliveries again.
        </p>
      )}
      {rows && deliveries.isError && (
        <div className="px-5 pb-4">
          <InlineError
            error={deliveries.error}
            title="Could not refresh deliveries"
            onRetry={() => deliveries.refetch()}
            retrying={deliveries.isFetching}
          />
        </div>
      )}
      {body}
    </section>
  );
}
