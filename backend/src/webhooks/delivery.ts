import { Worker, type ConnectionOptions, type DefaultJobOptions, type Job } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { signatureHeaders } from './signature.js';
import { EgressError, postToReceiver, type EgressPolicy } from './egress.js';
import { logger } from '../config/logger.js';

export const WEBHOOK_QUEUE = 'webhooks';

/**
 * One delivery of one event to one endpoint. `body` is the exact string that
 * is POSTed, built once at dispatch, so every attempt sends the same bytes.
 * `deliveryId` stays the same across the attempts of this delivery (jobs
 * queued by older versions have none). The secret itself is not stored in
 * redis, it is read at delivery time.
 */
export interface WebhookJobData {
  endpointId: string;
  event: string;
  body: string;
  deliveryId?: string;
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

/** From the first byte sent to the receiver's status line, DNS included. */
export const WEBHOOK_TIMEOUT_MS = 10_000;

/**
 * Backoff for the worker's `settings.backoffStrategy`. BullMQ passes the
 * number of attempts made so far, counting the one that just failed, so 1
 * after the first failure. -1 tells it not to retry.
 */
export function webhookBackoff(delays: readonly number[] = WEBHOOK_RETRY_DELAYS) {
  return (attemptsMade: number): number => delays[attemptsMade - 1] ?? -1;
}

export const newEventId = () => `evt_${randomUUID()}`;
export const newDeliveryId = () => `dlv_${randomUUID()}`;

/** The JSON body of an event, the same for every endpoint it is sent to. */
export function eventBody(event: string, data: Record<string, unknown>): string {
  return JSON.stringify({ id: newEventId(), event, timestamp: new Date().toISOString(), data });
}

export interface WebhookEndpointTarget {
  id: string;
  url: string;
  secret: string;
  isActive: boolean;
}

export interface DeliveryRecord {
  webhookEndpointId: string;
  eventType: string;
  payload: Record<string, unknown>;
  statusCode: number | null;
  /** Why the attempt failed, in our words; null when it was delivered. */
  error: string | null;
  retryCount: number;
}

export interface WebhookDeliveryDeps {
  /** The endpoint as it is now, or undefined once it has been deleted. */
  getEndpoint: (id: string) => Promise<WebhookEndpointTarget | undefined>;
  recordDelivery: (data: DeliveryRecord) => Promise<void>;
  /** Which receivers may be contacted, see egress.ts. */
  egress: EgressPolicy;
  /** Only for tests; production uses WEBHOOK_TIMEOUT_MS. */
  timeoutMs?: number;
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

export interface AttemptOutcome {
  delivered: boolean;
  statusCode: number | null;
  error: string | null;
}

/** POST one signed request to an endpoint and judge it on the status line. */
export async function attemptDelivery(
  endpoint: WebhookEndpointTarget,
  data: WebhookJobData,
  opts: { egress: EgressPolicy; timeoutMs?: number },
): Promise<AttemptOutcome> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'Sluby-Webhooks',
    'X-Sluby-Event': data.event,
    ...signatureHeaders(data.body, endpoint.secret),
  };
  if (data.deliveryId) headers['X-Sluby-Delivery'] = data.deliveryId;

  try {
    const { status } = await postToReceiver(endpoint.url, {
      headers,
      body: data.body,
      timeoutMs: opts.timeoutMs ?? WEBHOOK_TIMEOUT_MS,
      policy: opts.egress,
    });
    if (status >= 200 && status < 300) return { delivered: true, statusCode: status, error: null };
    if (status >= 300 && status < 400) {
      return {
        delivered: false,
        statusCode: status,
        error: `the receiver answered ${status}; redirects are not followed`,
      };
    }
    return { delivered: false, statusCode: status, error: `the receiver answered ${status}` };
  } catch (err) {
    const message = err instanceof EgressError ? err.message : 'request failed';
    if (!(err instanceof EgressError)) logger.warn({ err }, 'Unexpected webhook request error');
    return { delivered: false, statusCode: null, error: message };
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

  const outcome = await attemptDelivery(endpoint, data, deps);

  // the outcome of the request decides whether to retry, not this insert:
  // retrying a delivered webhook because its log row failed would send it twice
  try {
    await deps.recordDelivery({
      webhookEndpointId: endpoint.id,
      eventType: data.event,
      payload: JSON.parse(data.body) as Record<string, unknown>,
      statusCode: outcome.statusCode,
      error: outcome.error,
      retryCount,
    });
  } catch (err) {
    logger.error(
      { err, endpointId: endpoint.id, event: data.event },
      'Could not record webhook delivery attempt',
    );
  }

  if (!outcome.delivered) {
    throw new WebhookDeliveryError(
      `Webhook delivery failed: ${outcome.error ?? 'unknown error'}`,
      outcome.statusCode,
    );
  }
  logger.info({ endpointId: endpoint.id, event: data.event }, 'Webhook delivered');
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
