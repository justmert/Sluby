// what Needs attention lists, in order, from data the overview already has
import type { VideoAsset } from '@sluby/sdk';
import type { Reconciliation, SystemStatus } from '@/hooks/useStats';
import type { WebhookRecord } from '@/hooks/useWebhooks';

export type AttentionItem =
  | { kind: 'service'; key: string; service: 'indexer' | 'database' | 'redis' }
  | { kind: 'missing'; key: string; count: number; checkedAt: string }
  | { kind: 'failed'; key: string; video: VideoAsset }
  | { kind: 'webhook'; key: string; webhook: WebhookRecord }
  | { kind: 'stalled'; key: string; video: VideoAsset };

export interface AttentionInput {
  status?: SystemStatus;
  run?: Reconciliation | null;
  failed?: VideoAsset[];
  /** all failed videos, of which `failed` holds the newest */
  failedTotal?: number;
  stalled?: VideoAsset[];
  /** all stalled uploads, of which `stalled` holds the oldest */
  stalledTotal?: number;
  webhooks?: WebhookRecord[];
}

/** At most this many rows; the rest are counted under them. */
export const ATTENTION_LIMIT = 5;

/**
 * Every item, most urgent first: a service that is down explains most other
 * trouble, missing files break playback, then failed videos, failing
 * webhooks and uploads that never finished.
 */
export function attentionItems(input: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = [];
  const s = input.status;
  if (s) {
    for (const service of ['indexer', 'database', 'redis'] as const) {
      if (!s[service].ok) items.push({ kind: 'service', key: `service:${service}`, service });
    }
  }
  if (input.run && input.run.status !== 'failed' && input.run.missing_count > 0) {
    items.push({
      kind: 'missing',
      key: 'missing',
      count: input.run.missing_count,
      checkedAt: input.run.finished_at,
    });
  }
  for (const video of input.failed ?? []) items.push({ kind: 'failed', key: video.id, video });
  for (const webhook of input.webhooks ?? []) {
    if (webhook.isActive && webhook.lastDeliveryOk === false) {
      items.push({ kind: 'webhook', key: `webhook:${webhook.id}`, webhook });
    }
  }
  for (const video of input.stalled ?? []) items.push({ kind: 'stalled', key: video.id, video });
  return items;
}

/** How many items there are in all, counting failed videos and stalled uploads that were not fetched. */
export function attentionTotal(input: AttentionInput, items: AttentionItem[]): number {
  const failed = input.failed?.length ?? 0;
  const stalled = input.stalled?.length ?? 0;
  return (
    items.length +
    Math.max(0, (input.failedTotal ?? failed) - failed) +
    Math.max(0, (input.stalledTotal ?? stalled) - stalled)
  );
}
