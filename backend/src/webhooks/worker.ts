import { redisConnection, webhookQueue } from '../queue/bull-config.js';
import {
  findEndpointsForEvent,
  getWebhookEndpointById,
  createWebhookDelivery,
} from '../db/queries/webhooks.js';
import { WebhookDispatcher } from './dispatcher.js';
import { createWebhookWorker } from './delivery.js';

/**
 * The backend's webhook dispatcher and the worker that sends what it queues.
 * Importing this module starts the worker, like the other queue workers.
 */
export const webhookDispatcher = new WebhookDispatcher({
  getActiveWebhooksForEvent: async (event, owner) => {
    const endpoints = await findEndpointsForEvent(event, owner);
    return endpoints.map((ep) => ({
      id: ep.id,
      url: ep.url,
      events: ep.events,
      secret: ep.secret,
      isActive: ep.isActive,
    }));
  },
  queue: webhookQueue,
});

export const webhookWorker = createWebhookWorker({
  connection: redisConnection,
  deps: {
    getEndpoint: getWebhookEndpointById,
    recordDelivery: async (data) => {
      await createWebhookDelivery(data);
    },
  },
});

export async function closeWebhookWorker(): Promise<void> {
  await webhookWorker.close();
}
