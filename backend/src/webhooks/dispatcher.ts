import { generateSignature } from './signature.js';
import { logger } from '../config/logger.js';

export interface WebhookEndpointRecord {
  id: string;
  url: string;
  events: string[];
  secret: string;
  isActive: boolean;
}

export interface WebhookDispatcherDeps {
  getActiveWebhooksForEvent: (event: string) => Promise<WebhookEndpointRecord[]>;
  recordDelivery: (data: {
    webhookEndpointId: string;
    eventType: string;
    payload: Record<string, unknown>;
    statusCode: number | null;
    responseBody: string | null;
    retryCount: number;
  }) => Promise<void>;
}

export class WebhookDispatcher {
  private maxRetries = 3;
  private retryDelays = [10_000, 60_000, 300_000]; // 10s, 60s, 5min
  private timeoutMs = 10_000;

  constructor(private deps: WebhookDispatcherDeps) {}

  async dispatch(event: string, data: Record<string, unknown>): Promise<void> {
    const endpoints = await this.deps.getActiveWebhooksForEvent(event);

    if (endpoints.length === 0) {
      logger.debug({ event }, 'No webhook endpoints for event');
      return;
    }

    const payload = {
      event,
      timestamp: new Date().toISOString(),
      data,
    };

    const payloadStr = JSON.stringify(payload);

    // Dispatch to all matching endpoints in parallel
    await Promise.allSettled(
      endpoints.map((endpoint) => this.deliverWithRetry(endpoint, event, payloadStr, payload)),
    );
  }

  private async deliverWithRetry(
    endpoint: WebhookEndpointRecord,
    event: string,
    payloadStr: string,
    payload: Record<string, unknown>,
    retryCount = 0,
  ): Promise<void> {
    const signature = generateSignature(payloadStr, endpoint.secret);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Sluby-Signature': signature,
          'X-Sluby-Event': event,
        },
        body: payloadStr,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const responseBody = await response.text().catch(() => '');

      await this.deps.recordDelivery({
        webhookEndpointId: endpoint.id,
        eventType: event,
        payload,
        statusCode: response.status,
        responseBody: responseBody.slice(0, 1000),
        retryCount,
      });

      if (!response.ok && retryCount < this.maxRetries) {
        logger.warn({
          endpoint: endpoint.url,
          event,
          statusCode: response.status,
          retryCount,
        }, 'Webhook delivery failed, scheduling retry');

        await this.scheduleRetry(endpoint, event, payloadStr, payload, retryCount);
      } else if (response.ok) {
        logger.info({ endpoint: endpoint.url, event }, 'Webhook delivered');
      }
    } catch (err) {
      await this.deps.recordDelivery({
        webhookEndpointId: endpoint.id,
        eventType: event,
        payload,
        statusCode: null,
        responseBody: err instanceof Error ? err.message : 'Unknown error',
        retryCount,
      });

      if (retryCount < this.maxRetries) {
        logger.warn({ endpoint: endpoint.url, event, err, retryCount }, 'Webhook delivery error, scheduling retry');
        await this.scheduleRetry(endpoint, event, payloadStr, payload, retryCount);
      } else {
        logger.error({ endpoint: endpoint.url, event, err }, 'Webhook delivery permanently failed');
      }
    }
  }

  private async scheduleRetry(
    endpoint: WebhookEndpointRecord,
    event: string,
    payloadStr: string,
    payload: Record<string, unknown>,
    currentRetry: number,
  ): Promise<void> {
    const delay = this.retryDelays[currentRetry] ?? 300_000;

    setTimeout(() => {
      this.deliverWithRetry(endpoint, event, payloadStr, payload, currentRetry + 1)
        .catch((err) => {
          logger.error({ err, endpoint: endpoint.url, event }, 'Webhook retry failed');
        });
    }, delay);
  }
}
