import { Router, type Request, type Response } from 'express';
import { requireScope } from '../middleware/api-key.js';
import { AppError } from '../middleware/error-handler.js';
import { randomBytes } from 'node:crypto';

export interface WebhookRouteDeps {
  createWebhook: (data: {
    apiKeyId: string;
    url: string;
    events: string[];
    secret: string;
  }) => Promise<{ id: string }>;
  listWebhooks: (apiKeyId: string) => Promise<Array<{
    id: string;
    url: string;
    events: string[];
    isActive: boolean;
    createdAt: Date;
  }>>;
  /** Deletes only if the endpoint belongs to `apiKeyId`; false when it does not. */
  deleteWebhook: (id: string, apiKeyId: string) => Promise<boolean>;
}

const VALID_EVENTS = [
  'upload.started',
  'upload.completed',
  'upload.failed',
  'processing.started',
  'processing.progress',
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

    if (!url) {
      throw new AppError(400, 'URL is required');
    }

    if (!events || !Array.isArray(events) || events.length === 0) {
      throw new AppError(400, 'At least one event type is required');
    }

    const invalidEvents = events.filter((e: string) => !VALID_EVENTS.includes(e));
    if (invalidEvents.length > 0) {
      throw new AppError(400, `Invalid events: ${invalidEvents.join(', ')}`);
    }

    const secret = randomBytes(32).toString('hex');

    const webhook = await deps.createWebhook({
      apiKeyId: req.apiKey!.id,
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
    const webhooks = await deps.listWebhooks(req.apiKey!.id);

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
    // Scoped to the calling key so one caller cannot delete another's webhook.
    const deleted = await deps.deleteWebhook(String(req.params.id), req.apiKey!.id);
    if (!deleted) {
      throw new AppError(404, 'Webhook endpoint not found');
    }
    res.json({ success: true });
  });

  return router;
}
