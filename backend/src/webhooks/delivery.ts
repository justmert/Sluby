import { Worker, type ConnectionOptions, type DefaultJobOptions, type Job } from 'bullmq';
import { generateSignature } from './signature.js';
import { logger } from '../config/logger.js';

export const WEBHOOK_QUEUE = 'webhooks';

/**
 * One delivery of one event to one endpoint. `body` is the exact string that
 * is POSTed, built once at dispatch, so every attempt sends the same bytes
 * and the signature over them only changes if the endpoint's secret does.
 * The secret itself is not stored in redis, it is read at delivery time.
 */
export interface WebhookJobData {
  endpointId: string;
  event: string;
  body: string;
}

/** Waits before the 2nd, 3rd and 4th attempt; the first runs immediately. */
export const WEBHOOK_RETRY_DELAYS = [10_000, 60_000, 300_000];

export const WEBHOOK_BACKOFF_TYPE = 'webhook';

export const webhookJobOptions: DefaultJobOptions = {
  attempts: WEBHOOK_RETRY_DELAYS.length + 1,
  backoff: { type: WEBHOOK_BACKOFF_TYPE },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
};

const TIMEOUT_MS = 10_000;

/**
 * Backoff for the worker's `settings.backoffStrategy`. BullMQ passes the
 * number of attempts made so far, counting the one that just failed, so 1
 * after the first failure. -1 tells it not to retry.
 */
export function webhookBackoff(delays: readonly number[] = WEBHOOK_RETRY_DELAYS) {
  return (attemptsMade: number): number => delays[attemptsMade - 1] ?? -1;
}

export interface WebhookEndpointTarget {
  id: string;
  url: string;
  secret: string;
  isActive: boolean;
}

export interface WebhookDeliveryDeps {
  /** The endpoint as it is now, or undefined once it has been deleted. */
  getEndpoint: (id: string) => Promise<WebhookEndpointTarget | undefined>;
  recordDelivery: (data: {
    webhookEndpointId: string;
    eventType: string;
    payload: Record<string, unknown>;
    statusCode: number | null;
    responseBody: string | null;
    retryCount: number;
  }) => Promise<void>;
}

export class WebhookDeliveryError extends Error {
  constructor(
    message: string,
    readonly statusCode: number | null,
  ) {
    super(message);
    this.name = 'WebhookDeliveryError';
  }
}

/**
 * Make one delivery attempt. Throws when the endpoint answers non-2xx or
 * cannot be reached, so the queue retries it. `retryCount` is the number of
 * earlier attempts of this delivery.
 */
export async function deliverWebhook(
  deps: WebhookDeliveryDeps,
  data: WebhookJobData,
  retryCount: number,
): Promise<'delivered' | 'skipped'> {
  const endpoint = await deps.getEndpoint(data.endpointId);
  if (!endpoint || !endpoint.isActive) {
    logger.info(
      { endpointId: data.endpointId, event: data.event },
      'Webhook endpoint deleted or inactive, delivery dropped',
    );
    return 'skipped';
  }

  const record = async (statusCode: number | null, responseBody: string) => {
    // the outcome of the request decides whether to retry, not this insert:
    // retrying a delivered webhook because its log row failed would send it
    // twice
    try {
      await deps.recordDelivery({
        webhookEndpointId: endpoint.id,
        eventType: data.event,
        payload: JSON.parse(data.body) as Record<string, unknown>,
        statusCode,
        responseBody: responseBody.slice(0, 1000),
        retryCount,
      });
    } catch (err) {
      logger.error(
        { err, endpointId: endpoint.id, event: data.event },
        'Could not record webhook delivery attempt',
      );
    }
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let status: number;
  let responseBody: string;
  try {
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sluby-Signature': generateSignature(data.body, endpoint.secret),
        'X-Sluby-Event': data.event,
      },
      body: data.body,
      signal: controller.signal,
    });
    status = response.status;
    responseBody = await response.text().catch(() => '');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    await record(null, message);
    throw new WebhookDeliveryError(`Webhook request failed: ${message}`, null);
  } finally {
    clearTimeout(timeout);
  }

  await record(status, responseBody);
  if (status < 200 || status >= 300) {
    throw new WebhookDeliveryError(`Webhook endpoint answered ${status}`, status);
  }
  logger.info({ endpoint: endpoint.url, event: data.event }, 'Webhook delivered');
  return 'delivered';
}

export interface WebhookWorkerOptions {
  connection: ConnectionOptions;
  deps: WebhookDeliveryDeps;
  concurrency?: number;
  /** Only for tests that cannot wait minutes; production uses the default. */
  retryDelays?: readonly number[];
  /** Redis key prefix, lets tests use an isolated namespace. */
  prefix?: string;
}

export function createWebhookWorker(opts: WebhookWorkerOptions): Worker<WebhookJobData> {
  const worker = new Worker<WebhookJobData>(
    WEBHOOK_QUEUE,
    (job: Job<WebhookJobData>) => deliverWebhook(opts.deps, job.data, job.attemptsMade),
    {
      connection: opts.connection,
      concurrency: opts.concurrency ?? 4,
      settings: { backoffStrategy: webhookBackoff(opts.retryDelays) },
      ...(opts.prefix ? { prefix: opts.prefix } : {}),
    },
  );

  worker.on('failed', (job, error) => {
    if (!job) return;
    const final = job.attemptsMade >= (job.opts.attempts ?? 1);
    const details = {
      jobId: job.id,
      endpointId: job.data.endpointId,
      event: job.data.event,
      attemptsMade: job.attemptsMade,
      error: error.message,
    };
    if (final) logger.error(details, 'Webhook delivery permanently failed');
    else logger.warn(details, 'Webhook delivery failed, retry scheduled');
  });

  return worker;
}
