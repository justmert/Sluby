import { CirclePause, CirclePlay } from 'lucide-react';
import { StatusBadge } from '@/components/shared/StatusBadge';
import type { WebhookRecord } from '@/hooks/useWebhooks';
import { formatDate, formatRelativeTime } from '@/lib/formatters';

/** How the newest delivery went: a badge and how long ago, or why there is none. */
export function LastDelivery({ hook }: { hook: WebhookRecord }) {
  if (hook.lastDeliveryAt === null) {
    return <span className="text-muted-foreground">None yet</span>;
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <StatusBadge kind="delivery" status={hook.lastDeliveryOk ? 'delivered' : 'failed'} />
      <time
        dateTime={hook.lastDeliveryAt}
        title={formatDate(hook.lastDeliveryAt)}
        className="text-muted-foreground"
      >
        {formatRelativeTime(hook.lastDeliveryAt)}
      </time>
    </span>
  );
}

/** The icon of the Pause or Resume button, for the state the webhook is in. */
export function PauseIcon({ active }: { active: boolean }) {
  return active ? <CirclePause /> : <CirclePlay />;
}
