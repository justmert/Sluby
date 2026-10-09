import { statusSpec } from '@/components/shared/status';
import { movingCount, useAssetStats } from '@/hooks/useStats';
import { healthOf, useSystemStatus } from '@/hooks/useSystemStatus';
import { useWebhooks } from '@/hooks/useWebhooks';
import { ROUTES } from '@/lib/constants';
import { formatCount } from '@/lib/formatters';

/**
 * Something a nav item says about its page without opening it: a colored dot
 * (Health, Webhooks) or a count (Videos). `text` is what the dot means in
 * words; it goes into the link's accessible name and the collapsed tooltip.
 */
export type NavSignal =
  | { kind: 'dot'; tone: 'success' | 'warning' | 'danger' | 'neutral'; text: string }
  | { kind: 'count'; count: number; text: string };

// webhooks change rarely and a failed delivery is not an emergency; once a
// minute is enough for the dot, and the webhooks pages share the cache entry
const WEBHOOK_POLL_MS = 60_000;

/** The signals for the nav, by item path. Members get no Health signal: they have no Health page. */
export function useNavSignals(operator: boolean): Partial<Record<string, NavSignal>> {
  const status = useSystemStatus({ poll: true });
  const stats = useAssetStats();
  const webhooks = useWebhooks({ refetchInterval: WEBHOOK_POLL_MS });
  const signals: Partial<Record<string, NavSignal>> = {};

  if (operator) {
    if (status.isError && !status.data) {
      signals[ROUTES.DEPLOYMENT] = { kind: 'dot', tone: 'neutral', text: 'could not check' };
    } else {
      const health = healthOf(status.data);
      const spec = statusSpec('health', health);
      const tone =
        health === 'ok'
          ? 'success'
          : health === 'degraded'
            ? 'warning'
            : health === 'down'
              ? 'danger'
              : 'neutral';
      signals[ROUTES.DEPLOYMENT] = { kind: 'dot', tone, text: spec.label.toLowerCase() };
    }
  }

  const moving = stats.data ? movingCount(stats.data) : 0;
  if (moving > 0) {
    signals[ROUTES.VIDEOS] = {
      kind: 'count',
      count: moving,
      text: `${formatCount(moving)} processing`,
    };
  }

  // a paused endpoint gets nothing sent, so its old failure is not news
  const failing = webhooks.data?.data.some((w) => w.isActive && w.lastDeliveryOk === false);
  if (failing) {
    signals[ROUTES.WEBHOOKS] = { kind: 'dot', tone: 'danger', text: 'a delivery failed' };
  }

  return signals;
}
