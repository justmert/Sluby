import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { VideoAsset } from '@sluby/sdk';
import { failureInfo } from '@/components/asset/processing';
import { RetryProcessingButton } from '@/components/asset/RetryProcessingButton';
import { AnimatedItem, AnimatedList } from '@/components/motion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useProcessingJob } from '@/hooks/asset-detail-queries';
import { webhookLabel } from '@/hooks/useWebhooks';
import { ROUTES } from '@/lib/constants';
import { formatCount, formatRelativeTime, plural } from '@/lib/formatters';
import { lateReveal } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { ATTENTION_LIMIT, type AttentionItem } from './attention';

const SERVICE: Record<'indexer' | 'database' | 'redis', { title: string; why: string }> = {
  indexer: {
    title: 'This server cannot reach the Sia indexer',
    why: 'New videos cannot be stored on Sia until it answers again.',
  },
  database: {
    title: 'The database is not responding',
    why: 'Most of the Studio cannot load until it answers again.',
  },
  redis: {
    title: 'The job queue is not responding',
    why: 'New uploads wait to be processed until it answers again.',
  },
};

type Tone = 'destructive' | 'warning';

// a title that leads somewhere is a plain link in the ink colour, like the board
const TITLE_LINK =
  'rounded-sm font-semibold text-foreground wrap-anywhere hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

function Row({
  tone,
  chip,
  title,
  why,
  action,
}: {
  tone: Tone;
  chip: string;
  title: ReactNode;
  why: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 rounded-lg border-t border-border-soft px-2 py-3 transition-colors duration-150 ease-design hover:bg-background">
      <Badge variant={tone}>{chip}</Badge>
      <div className="min-w-48 flex-1">
        <p className="font-semibold wrap-anywhere">{title}</p>
        <p className="text-muted-foreground">{why}</p>
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}

const quoted = (title: string) => <span dir="auto">{title}</span>;

function FailedRow({ video }: { video: VideoAsset }) {
  const job = useProcessingJob(video.id, video.status, true);
  const info = failureInfo(job.data, video);
  return (
    <Row
      tone="destructive"
      chip="Failed"
      title={
        <Link to={ROUTES.video(video.id)} className={TITLE_LINK}>
          {quoted(video.title)}
        </Link>
      }
      why={job.data ? info.body : 'Processing failed.'}
      action={
        !job.data ? (
          // the reason decides the action; hold its room until it is known
          <Skeleton className={cn('h-8 w-28', lateReveal)} />
        ) : info.action === 'retry' ? (
          <RetryProcessingButton asset={video} named compact variant="outline" size="sm" />
        ) : (
          <Button variant="outline" size="sm" asChild>
            <Link to={ROUTES.UPLOAD}>Upload again</Link>
          </Button>
        )
      }
    />
  );
}

function ItemRow({ item, operator }: { item: AttentionItem; operator: boolean }) {
  const openHealth = operator && (
    <Button variant="outline" size="sm" asChild>
      <Link to={ROUTES.DEPLOYMENT}>Open health</Link>
    </Button>
  );
  switch (item.kind) {
    case 'service':
      return (
        <Row
          tone="destructive"
          chip="Down"
          title={SERVICE[item.service].title}
          why={
            operator
              ? SERVICE[item.service].why
              : `${SERVICE[item.service].why} Ask the operator of this server.`
          }
          action={openHealth}
        />
      );
    case 'missing':
      return (
        <Row
          tone="destructive"
          chip="Missing"
          title={`${plural(item.count, 'file is', 'files are')} missing from Sia`}
          why={`Videos that use them may not play. Found by the storage check ${formatRelativeTime(item.checkedAt)}.`}
          action={openHealth}
        />
      );
    case 'failed':
      return <FailedRow video={item.video} />;
    case 'webhook':
    case 'paused': {
      const label = webhookLabel(item.webhook.url);
      return (
        <Row
          tone="warning"
          chip={item.kind === 'paused' ? 'Paused' : 'Failing'}
          title={
            <Link to={ROUTES.webhook(item.webhook.id)} className={TITLE_LINK}>
              {label}
            </Link>
          }
          why={
            item.kind === 'paused'
              ? 'Webhook paused. Events are not being sent.'
              : item.webhook.lastDeliveryAt
                ? `Deliveries are failing. Last attempt ${formatRelativeTime(item.webhook.lastDeliveryAt)}.`
                : 'The last delivery did not reach your endpoint.'
          }
          action={
            <Button variant="outline" size="sm" asChild>
              <Link to={ROUTES.webhook(item.webhook.id)} aria-label={`Open webhook ${label}`}>
                Open webhook
              </Link>
            </Button>
          }
        />
      );
    }
    case 'stalled':
      return (
        <Row
          tone="warning"
          chip="Interrupted"
          title={
            <Link to={ROUTES.video(item.video.id)} className={TITLE_LINK}>
              {quoted(item.video.title)}
            </Link>
          }
          why={`The upload did not finish. Started ${formatRelativeTime(item.video.createdAt)}.`}
          action={
            <Button variant="outline" size="sm" asChild>
              <Link to={ROUTES.video(item.video.id)} aria-label={`Open video ${item.video.title}`}>
                Open video
              </Link>
            </Button>
          }
        />
      );
  }
}

/** Where "and {n} more" leads: the list the first hidden item belongs to. */
function moreLink(item: AttentionItem | undefined): string {
  switch (item?.kind) {
    case 'webhook':
    case 'paused':
      return ROUTES.WEBHOOKS;
    case 'stalled':
      return `${ROUTES.VIDEOS}?status=${item.video.status}`;
    case 'service':
    case 'missing':
      return ROUTES.DEPLOYMENT;
    default:
      return `${ROUTES.VIDEOS}?status=failed`;
  }
}

/** The card's frame, also drawn while the page waits for its first answers. */
export function AttentionFrame({ count, children }: { count?: number; children: ReactNode }) {
  return (
    <section
      aria-labelledby="needs-attention"
      className="flex min-w-0 flex-[2_1_520px] flex-col gap-1 rounded-xl border bg-card px-6 py-5"
    >
      <div className="mb-2 flex items-center gap-2">
        <h2 id="needs-attention" className="font-heading text-heading">
          Needs attention
        </h2>
        {count !== undefined && count > 0 && (
          <Badge variant="warning" className="tabular-nums">
            <span className="sr-only">Items: </span>
            {formatCount(count)}
          </Badge>
        )}
      </div>
      {children}
    </section>
  );
}

/**
 * What needs the user now (D-07): services down, files missing from Sia,
 * failed videos, failing or paused webhooks, uploads that never finished.
 * With nothing to do, the card says so and keeps its place beside Status.
 */
export function NeedsAttention({
  items,
  total,
  operator,
  stagger,
}: {
  items: AttentionItem[];
  total: number;
  operator: boolean;
  stagger: boolean;
}) {
  const shown = items.slice(0, ATTENTION_LIMIT);
  const more = total - shown.length;
  return (
    <AttentionFrame count={total}>
      {shown.length === 0 ? (
        <p className="border-t border-border-soft px-2 py-3 text-muted-foreground">
          Nothing needs your attention.
        </p>
      ) : (
        <AnimatedList
          aria-labelledby="needs-attention"
          initial={stagger ? 'hidden' : false}
          className="flex flex-col"
        >
          {shown.map((item) => (
            <AnimatedItem key={item.key}>
              <ItemRow item={item} operator={operator} />
            </AnimatedItem>
          ))}
        </AnimatedList>
      )}
      {more > 0 && (
        <p className="border-t border-border-soft px-2 pt-3">
          <Link
            to={moreLink(items[ATTENTION_LIMIT] ?? items[items.length - 1])}
            className="font-semibold text-primary hover:text-primary-hover"
          >
            and {formatCount(more)} more
          </Link>
        </p>
      )}
    </AttentionFrame>
  );
}
