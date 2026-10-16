import type { Queue } from 'bullmq';
import { logger } from '../config/logger.js';
import { eventBody, newDeliveryId, type WebhookJobData } from './delivery.js';

export interface WebhookEndpointRecord {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
}

export interface WebhookDispatcherDeps {
  /** Endpoints of `owner` subscribed to `event`. */
  getActiveWebhooksForEvent: (event: string, owner: string) => Promise<WebhookEndpointRecord[]>;
  /** The webhooks queue; its default job options carry attempts and backoff. */
  queue: Pick<Queue<WebhookJobData>, 'addBulk'>;
}

export class WebhookDispatcher {
  constructor(private deps: WebhookDispatcherDeps) {}

  /**
   * Queue `event` for the subscribed endpoints of `owner`, the account the
   * event's asset belongs to. Never to anyone else's endpoints. The webhooks
   * worker sends it, so pending deliveries and retries live in redis and
   * survive a restart.
   */
  async dispatch(event: string, data: Record<string, unknown>, owner: string): Promise<void> {
    if (!owner) {
      logger.warn({ event }, 'Webhook event without an owner; not delivered');
      return;
    }
    const endpoints = await this.deps.getActiveWebhooksForEvent(event, owner);

    if (endpoints.length === 0) {
      logger.debug({ event }, 'No webhook endpoints for event');
      return;
    }

    // one event id for every endpoint, so a receiver can drop a repeat
    const body = eventBody(event, data);

    // ids are left to bullmq: each dispatch is a new event and must never be
    // dropped as a duplicate of an earlier job, which a fixed id would risk
    // since bullmq ignores an add whose id it still holds
    await this.deps.queue.addBulk(
      endpoints.map((endpoint) => ({
        name: event,
        data: { endpointId: endpoint.id, event, body, deliveryId: newDeliveryId() },
      })),
    );
  }

  /**
   * Queue one delivery as it is, for a resend. It gets the same attempts and
   * backoff as any delivery.
   */
  async enqueue(job: WebhookJobData): Promise<void> {
    await this.deps.queue.addBulk([{ name: job.event, data: job }]);
  }
}
