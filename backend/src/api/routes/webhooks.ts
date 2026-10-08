import { Router, type Request, type Response } from 'express';
import { requireScope } from '../middleware/api-key.js';
import { AppError } from '../middleware/error-handler.js';
import { ownerFilter } from '../ownership.js';
import { randomBytes } from 'node:crypto';

export interface WebhookRouteDeps {
  createWebhook: (data: {
    creatorAddress: string;
    /** The key it was registered with; null for a studio session. */
    apiKeyId: string | null;
    url: string;
    events: string[];
    secret: string;
  }) => Promise<{ id: string }>;
  /**
   * The owner arguments below come from ownerFilter: undefined (the platform
   * identity) means every account.
   */
  listWebhooks: (owner: string | undefined) => Promise<
    Array<{
      id: string;
      url: string;
      events: string[];
      isActive: boolean;
      createdAt: Date;
    }>
  >;
  /** Deletes only if the endpoint belongs to the account; false when it does not. */
  deleteWebhook: (id: string, owner: string | undefined) => Promise<boolean>;
  /**
   * Why a receiver URL may not be registered (not http(s), or its host
   * resolves to an address webhooks may not reach), or null when it may.
   */
  vetWebhookUrl: (url: string) => Promise<string | null>;
  /** Send a signed `webhook.test` event now; null when the endpoint is not the account's. */
  testWebhook: (
    id: string,
    owner: string | undefined,
  ) => Promise<{ delivered: boolean; statusCode: number | null; error: string | null } | null>;
  /** The endpoint's latest delivery attempts, newest first; null when it is not the account's. */
  listWebhookDeliveries: (
    id: string,
    owner: string | undefined,
    limit: number,
  ) => Promise<Array<{
    id: string;
    eventId: string | null;
    event: string;
    statusCode: number | null;
    error: string | null;
    attempt: number;
    createdAt: Date;
  }> | null>;
}

/** Events the pipeline actually emits. */
export const WEBHOOK_EVENTS = [
  'upload.started',
  'upload.completed',
  'upload.failed',
  'processing.started',
  'asset.ready',
  'asset.errored',
];

export function createWebhookRoutes(deps: WebhookRouteDeps): Router {
  const router = Router();

  /**
   * POST /api/v1/webhooks
   * Register a new webhook endpoint.
   */
  router.post('/', requireScope('manage'), async (req: Request, res: Response) => {
    const { url, events } = req.body;

    if (!url || typeof url !== 'string') {
      throw new AppError(400, 'URL is required');
    }
    // checked again before every delivery, since dns can change after this
    const refused = await deps.vetWebhookUrl(url);
    if (refused) throw new AppError(400, `URL refused: ${refused}`);

    if (!events || !Array.isArray(events) || events.length === 0) {
      throw new AppError(400, 'At least one event type is required');
    }

    const invalidEvents = events.filter((e: string) => !WEBHOOK_EVENTS.includes(e));
    if (invalidEvents.length > 0) {
      throw new AppError(400, `Invalid events: ${invalidEvents.join(', ')}`);
    }

    const secret = randomBytes(32).toString('hex');

    const caller = req.apiKey!;
    const webhook = await deps.createWebhook({
      creatorAddress: caller.creatorAddress,
      // a studio session has a synthetic id, not a key row
      apiKeyId: caller.id.startsWith('session:') ? null : caller.id,
      url,
      events,
      secret,
    });

    res.status(201).json({
      id: webhook.id,
      url,
      events,
      secret, // Only shown once at creation
    });
  });

  /**
   * GET /api/v1/webhooks
   * List registered webhook endpoints. Needs `manage` like creating them:
   * receiver URLs often carry credentials or hook tokens.
   */
  router.get('/', requireScope('manage'), async (req: Request, res: Response) => {
    const webhooks = await deps.listWebhooks(ownerFilter(req.apiKey!.creatorAddress));

    res.json({
      data: webhooks.map((w) => ({
        id: w.id,
        url: w.url,
        events: w.events,
        is_active: w.isActive,
        created_at: w.createdAt.toISOString(),
      })),
    });
  });

  /**
   * DELETE /api/v1/webhooks/:id
   * Remove a webhook endpoint.
   */
  router.delete('/:id', requireScope('manage'), async (req: Request, res: Response) => {
    // scoped to the caller's account so one tenant cannot delete another's webhook
    const deleted = await deps.deleteWebhook(
      String(req.params.id),
      ownerFilter(req.apiKey!.creatorAddress),
    );
    if (!deleted) {
      throw new AppError(404, 'Webhook endpoint not found');
    }
    res.json({ success: true });
  });

  /**
   * POST /api/v1/webhooks/:id/test
   * Send a signed `webhook.test` event to the endpoint now and report how the
   * receiver answered. Recorded with the other deliveries.
   */
  router.post('/:id/test', requireScope('manage'), async (req: Request, res: Response) => {
    const result = await deps.testWebhook(
      String(req.params.id),
      ownerFilter(req.apiKey!.creatorAddress),
    );
    if (!result) throw new AppError(404, 'Webhook endpoint not found');
    res.json({
      delivered: result.delivered,
      status_code: result.statusCode,
      error: result.error,
    });
  });

  /**
   * GET /api/v1/webhooks/:id/deliveries
   * The endpoint's latest delivery attempts, newest first: the event, the
   * receiver's status code and, for a failure, why. Response bodies are
   * never stored.
   */
  router.get('/:id/deliveries', requireScope('manage'), async (req: Request, res: Response) => {
    const raw = req.query.limit;
    const limit = raw === undefined ? 50 : Number(raw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new AppError(400, 'limit must be an integer from 1 to 100');
    }
    const rows = await deps.listWebhookDeliveries(
      String(req.params.id),
      ownerFilter(req.apiKey!.creatorAddress),
      limit,
    );
    if (!rows) throw new AppError(404, 'Webhook endpoint not found');
    res.json({
      data: rows.map((d) => ({
        id: d.id,
        event_id: d.eventId,
        event: d.event,
        status_code: d.statusCode,
        delivered: d.statusCode !== null && d.statusCode >= 200 && d.statusCode < 300,
        error: d.error,
        attempt: d.attempt,
        created_at: d.createdAt.toISOString(),
      })),
    });
  });

  return router;
}
