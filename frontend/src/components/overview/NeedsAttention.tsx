import { Link } from 'react-router';
import type { VideoAsset } from '@sluby/sdk';
import { CircleAlert, TriangleAlert } from 'lucide-react';
import { failureInfo } from '@/components/asset/processing';
import { RetryProcessingButton } from '@/components/asset/RetryProcessingButton';
import { AnimatedItem, AnimatedList } from '@/components/motion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useProcessingJob } from '@/hooks/asset-detail-queries';
import { webhookLabel } from '@/hooks/useWebhooks';
import { ROUTES } from '@/lib/constants';
import { formatCount, formatRelativeTime, plural } from '@/lib/formatters';
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

function Row({
  tone,
  title,
  why,
  action,
}: {
  tone: 'danger' | 'warning';
  title: React.ReactNode;
  why: React.ReactNode;
  action?: React.ReactNode;
}) {
  const Icon = tone === 'danger' ? CircleAlert : TriangleAlert;
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-3 py-3 @lg/attention:grid-cols-[auto_1fr_auto] @lg/attention:items-center">
      <Icon
        aria-hidden="true"
        className={
          tone === 'danger'
            ? 'mt-0.5 size-4 text-destructive'
            : 'mt-0.5 size-4 text-warning-foreground'
        }
      />
      <div className="min-w-0">
        <p className="text-sm font-medium wrap-anywhere">{title}</p>
        <p className="text-sm text-muted-foreground">{why}</p>
      </div>
      {action && (
        <div className="col-start-2 mt-2 flex flex-wrap gap-2 @lg/attention:col-start-3 @lg/attention:mt-0">
          {action}
        </div>
      )}
    </div>
  );
}

const quoted = (title: string) => <span dir="auto">“{title}”</span>;

function OpenVideo({ video }: { video: VideoAsset }) {
  return (
    <Button variant="outline" size="sm" asChild>
      <Link to={ROUTES.video(video.id)} aria-label={`Open video ${video.title}`}>
        Open video
      </Link>
    </Button>
  );
}

function FailedRow({ video }: { video: VideoAsset }) {
  const job = useProcessingJob(video.id, video.status, true);
  const info = failureInfo(job.data, video);
  return (
    <Row
      tone="danger"
      title={<>{quoted(video.title)} failed</>}
      why={job.data ? info.body : 'Processing failed.'}
      action={
        <>
          {info.action === 'retry' && job.data && (
            <RetryProcessingButton asset={video} named variant="outline" size="sm" />
          )}
          <OpenVideo video={video} />
        </>
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
          tone="danger"
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
          tone="danger"
          title={`${plural(item.count, 'file is', 'files are')} missing from Sia`}
          why={`Videos that use them may not play. Found by the storage check ${formatRelativeTime(item.checkedAt)}.`}
          action={openHealth}
        />
      );
    case 'failed':
      return <FailedRow video={item.video} />;
    case 'webhook':
      return (
        <Row
          tone="warning"
          title={`Deliveries to ${webhookLabel(item.webhook.url)} are failing`}
          why={
            item.webhook.lastDeliveryAt
              ? `Last attempt ${formatRelativeTime(item.webhook.lastDeliveryAt)}`
              : 'The last delivery did not reach your endpoint.'
          }
          action={
            <Button variant="outline" size="sm" asChild>
              <Link
                to={ROUTES.webhook(item.webhook.id)}
                aria-label={`Open webhook ${webhookLabel(item.webhook.url)}`}
              >
                Open webhook
              </Link>
            </Button>
          }
        />
      );
    case 'stalled':
      return (
        <Row
          tone="warning"
          title={<>{quoted(item.video.title)} did not finish uploading</>}
          why={`Started ${formatRelativeTime(item.video.createdAt)}. Upload the file again, or delete the video.`}
          action={<OpenVideo video={item.video} />}
        />
      );
  }
}

/** Where "and {n} more" leads: the list the first hidden item belongs to. */
function moreLink(item: AttentionItem | undefined): string {
  switch (item?.kind) {
    case 'webhook':
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

/**
 * What needs the user now (D-07): services down, files missing from Sia,
 * failed videos, failing webhooks, uploads that never finished. Nothing is
 * drawn when the list is empty.
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
    <Card className="@container/attention">
      <CardHeader>
        <CardTitle id="needs-attention">Needs attention</CardTitle>
        <CardAction>
          <Badge variant="secondary" className="tabular-nums">
            <span className="sr-only">Items: </span>
            {formatCount(total)}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <AnimatedList
          aria-labelledby="needs-attention"
          initial={stagger ? 'hidden' : false}
          className="-my-3 flex flex-col divide-y"
        >
          {shown.map((item) => (
            <AnimatedItem key={item.key}>
              <ItemRow item={item} operator={operator} />
            </AnimatedItem>
          ))}
        </AnimatedList>
        {more > 0 && (
          <p className="mt-3 border-t pt-3 text-sm">
            <Link
              to={moreLink(items[ATTENTION_LIMIT] ?? items[items.length - 1])}
              className="font-medium text-primary underline-offset-4 hover:underline"
            >
              and {formatCount(more)} more
            </Link>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
