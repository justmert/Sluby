import { Router, type Request, type Response } from 'express';
import { requireScope } from '../middleware/api-key.js';
import { AppError } from '../middleware/error-handler.js';
import { ownerFilter } from '../ownership.js';
import { randomBytes } from 'node:crypto';

/** An endpoint as the routes answer it. */
export interface WebhookRecord {
  id: string;
  url: string;
  events: string[];
  isActive: boolean;
  createdAt: Date;
  /** When the newest delivery attempt was made; null before the first. */
  lastDeliveryAt: Date | null;
  /** Whether that attempt was delivered; null before the first. */
  lastDeliveryOk: boolean | null;
}

function formatWebhook(w: WebhookRecord) {
  return {
    id: w.id,
    url: w.url,
    events: w.events,
    is_active: w.isActive,
    created_at: w.createdAt.toISOString(),
    last_delivery_at: w.lastDeliveryAt ? w.lastDeliveryAt.toISOString() : null,
    last_delivery_ok: w.lastDeliveryOk,
  };
}

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
  listWebhooks: (owner: string | undefined) => Promise<WebhookRecord[]>;
  /** One endpoint, or null when it is not the account's. */
  getWebhook: (id: string, owner: string | undefined) => Promise<WebhookRecord | null>;
  /** Changes the given fields of an endpoint of the account; null when it is not theirs. */
  updateWebhook: (
    id: string,
    owner: string | undefined,
    patch: { url?: string; events?: string[]; isActive?: boolean },
  ) => Promise<WebhookRecord | null>;
  /** Stores a new signing secret; false when the endpoint is not the account's. */
  rotateWebhookSecret: (id: string, owner: string | undefined, secret: string) => Promise<boolean>;
  /**
   * Queue the stored payload of delivery `deliveryId` again, unchanged (same
   * event id). `not_found` when the endpoint is not the account's or has no
   * such delivery, `paused` when the endpoint is paused.
   */
  redeliverWebhook: (
    id: string,
    owner: string | undefined,
    deliveryId: string,
  ) => Promise<
    { status: 'queued'; deliveryId: string } | { status: 'not_found' } | { status: 'paused' }
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

const newSigningSecret = () => randomBytes(32).toString('hex');

/** Longest receiver URL accepted, well past any real one. */
export const WEBHOOK_URL_MAX = 2048;

const PATCH_FIELDS = ['url', 'events', 'is_active'];

function checkUrlShape(url: unknown): asserts url is string {
  if (!url || typeof url !== 'string') {
    throw new AppError(400, 'URL is required');
  }
  if (url.length > WEBHOOK_URL_MAX) {
    throw new AppError(400, 'The URL is longer than 2,048 characters.');
  }
}

function checkEvents(events: unknown): asserts events is string[] {
  if (!events || !Array.isArray(events) || events.length === 0) {
    throw new AppError(400, 'At least one event type is required');
  }
  const invalidEvents = events.filter((e: unknown) => !WEBHOOK_EVENTS.includes(e as string));
  if (invalidEvents.length > 0) {
    throw new AppError(400, `Invalid events: ${invalidEvents.join(', ')}`);
  }
}

export function createWebhookRoutes(deps: WebhookRouteDeps): Router {
  const router = Router();

  /**
   * POST /api/v1/webhooks
   * Register a new webhook endpoint.
   */
  router.post('/', requireScope('manage'), async (req: Request, res: Response) => {
    const { url, events } = req.body ?? {};

    checkUrlShape(url);
    // checked again before every delivery, since dns can change after this
    const refused = await deps.vetWebhookUrl(url);
    if (refused) throw new AppError(400, `URL refused: ${refused}`);

    checkEvents(events);

    const secret = newSigningSecret();

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

    res.json({ data: webhooks.map(formatWebhook) });
  });

  /**
   * GET /api/v1/webhooks/:id
   * One endpoint, with how its newest delivery went.
   */
  router.get('/:id', requireScope('manage'), async (req: Request, res: Response) => {
    const webhook = await deps.getWebhook(
      String(req.params.id),
      ownerFilter(req.apiKey!.creatorAddress),
    );
    if (!webhook) throw new AppError(404, 'Webhook endpoint not found');
    res.json(formatWebhook(webhook));
  });

  /**
   * PATCH /api/v1/webhooks/:id
   * Change the receiver URL or the events, or pause (`is_active: false`) and
   * resume the endpoint. A paused endpoint is sent nothing, and deliveries
   * already queued for it are dropped when their turn comes.
   */
  router.patch('/:id', requireScope('manage'), async (req: Request, res: Response) => {
    const body: Record<string, unknown> =
      req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const unknown = Object.keys(body).filter((k) => !PATCH_FIELDS.includes(k));
    if (unknown.length > 0) {
      throw new AppError(
        400,
        `unknown field${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}`,
      );
    }
    if (!PATCH_FIELDS.some((k) => body[k] !== undefined)) {
      throw new AppError(400, 'Send at least one of url, events and is_active');
    }
    const patch: { url?: string; events?: string[]; isActive?: boolean } = {};
    if (body.url !== undefined) {
      checkUrlShape(body.url);
      const refused = await deps.vetWebhookUrl(body.url);
      if (refused) throw new AppError(400, `URL refused: ${refused}`);
      patch.url = body.url;
    }
    if (body.events !== undefined) {
      checkEvents(body.events);
      patch.events = [...new Set(body.events)];
    }
    if (body.is_active !== undefined) {
      if (typeof body.is_active !== 'boolean') {
        throw new AppError(400, 'is_active must be true or false');
      }
      patch.isActive = body.is_active;
    }
    const updated = await deps.updateWebhook(
      String(req.params.id),
      ownerFilter(req.apiKey!.creatorAddress),
      patch,
    );
    if (!updated) throw new AppError(404, 'Webhook endpoint not found');
    res.json(formatWebhook(updated));
  });

  /**
   * POST /api/v1/webhooks/:id/rotate-secret
   * Replace the signing secret, for one that leaked. The old secret stops
   * at once, retries already queued included; the new one is shown only here.
   */
  router.post('/:id/rotate-secret', requireScope('manage'), async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const secret = newSigningSecret();
    const rotated = await deps.rotateWebhookSecret(
      id,
      ownerFilter(req.apiKey!.creatorAddress),
      secret,
    );
    if (!rotated) throw new AppError(404, 'Webhook endpoint not found');
    res.json({ id, secret });
  });

  /**
   * POST /api/v1/webhooks/:id/deliveries/:deliveryId/redeliver
   * Send a logged delivery's payload again, with the same event id so a
   * receiver that already handled it can drop it. Queued like any delivery,
   * with the usual retries; its attempts are logged with `manual: true`.
   */
  router.post(
    '/:id/deliveries/:deliveryId/redeliver',
    requireScope('manage'),
    async (req: Request, res: Response) => {
      const result = await deps.redeliverWebhook(
        String(req.params.id),
        ownerFilter(req.apiKey!.creatorAddress),
        String(req.params.deliveryId),
      );
      if (result.status === 'not_found') throw new AppError(404, 'Delivery not found');
      if (result.status === 'paused') {
        throw new AppError(409, 'This webhook is paused. Resume it to resend.');
      }
      res.status(202).json({ delivery_id: result.deliveryId });
    },
  );

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
