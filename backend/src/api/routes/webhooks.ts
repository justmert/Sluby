import { Router, type Request, type Response } from 'express';
import { requireScope } from '../middleware/api-key.js';
import { AppError } from '../middleware/error-handler.js';
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
  listWebhooks: (creatorAddress: string) => Promise<
    Array<{
      id: string;
      url: string;
      events: string[];
      isActive: boolean;
      createdAt: Date;
    }>
  >;
  /** Deletes only if the endpoint belongs to the account; false when it does not. */
  deleteWebhook: (id: string, creatorAddress: string) => Promise<boolean>;
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
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new AppError(400, 'URL must be an absolute http(s) URL');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new AppError(400, 'URL must be an absolute http(s) URL');
    }

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
   * List registered webhook endpoints.
   */
  router.get('/', requireScope('read'), async (req: Request, res: Response) => {
    const webhooks = await deps.listWebhooks(req.apiKey!.creatorAddress);

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
    // Scoped to the caller's account so one tenant cannot delete another's webhook.
    const deleted = await deps.deleteWebhook(String(req.params.id), req.apiKey!.creatorAddress);
    if (!deleted) {
      throw new AppError(404, 'Webhook endpoint not found');
    }
    res.json({ success: true });
  });

  return router;
}
