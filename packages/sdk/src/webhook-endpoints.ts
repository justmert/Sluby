import { readJson } from './errors.js';
import type {
  CreateWebhookEndpointInput,
  CreatedWebhookEndpoint,
  RequestOptions,
  UpdateWebhookEndpointInput,
  WebhookDelivery,
  WebhookEndpoint,
  WebhookEventName,
  WebhookTestResult,
} from './types.js';
import type { FetchFn } from './uploads.js';

/**
 * Manages the account's webhook endpoints. Every call needs the `manage`
 * scope, since receiver URLs often carry credentials. Verifying the requests
 * an endpoint receives is `client.webhooks`.
 */
export class WebhookEndpointManager {
  private readonly _fetch: FetchFn;

  constructor(fetchFn: FetchFn) {
    this._fetch = fetchFn;
  }

  /** The account's registered endpoints, paused ones included, newest first. */
  async list(options?: RequestOptions): Promise<WebhookEndpoint[]> {
    const res = await this._fetch('/api/v1/webhooks', { signal: options?.signal });
    const body = await readJson(res);
    return (body.data as Array<Record<string, unknown>>).map(mapEndpoint);
  }

  /** One endpoint, with how its newest delivery went. */
  async get(endpointId: string, options?: RequestOptions): Promise<WebhookEndpoint> {
    const res = await this._fetch(`/api/v1/webhooks/${encodeURIComponent(endpointId)}`, {
      signal: options?.signal,
    });
    return mapEndpoint(await readJson(res));
  }

  /**
   * Change an endpoint's URL or events, or pause (`isActive: false`) and
   * resume it. A paused endpoint is sent nothing. The signing secret stays.
   */
  async update(
    endpointId: string,
    input: UpdateWebhookEndpointInput,
    options?: RequestOptions,
  ): Promise<WebhookEndpoint> {
    const payload: Record<string, unknown> = {};
    if (input.url !== undefined) payload.url = input.url;
    if (input.events !== undefined) payload.events = input.events;
    if (input.isActive !== undefined) payload.is_active = input.isActive;
    const res = await this._fetch(`/api/v1/webhooks/${encodeURIComponent(endpointId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: options?.signal,
    });
    return mapEndpoint(await readJson(res));
  }

  /**
   * Replace the endpoint's signing secret, for one that leaked. The old one
   * stops at once, retries already queued included. The new secret is only
   * ever returned here.
   */
  async rotateSecret(
    endpointId: string,
    options?: RequestOptions,
  ): Promise<{ id: string; secret: string }> {
    const res = await this._fetch(
      `/api/v1/webhooks/${encodeURIComponent(endpointId)}/rotate-secret`,
      { method: 'POST', signal: options?.signal },
    );
    const body = await readJson(res);
    return { id: body.id as string, secret: body.secret as string };
  }

  /**
   * Send a logged delivery again: its stored payload, with the same event id,
   * queued with the usual retries. Rejects with a `ConflictError` while the
   * endpoint is paused. `deliveryId` is the `X-Sluby-Delivery` the resend carries.
   */
  async redeliver(
    endpointId: string,
    deliveryId: string,
    options?: RequestOptions,
  ): Promise<{ deliveryId: string }> {
    const res = await this._fetch(
      `/api/v1/webhooks/${encodeURIComponent(endpointId)}/deliveries/${encodeURIComponent(
        deliveryId,
      )}/redeliver`,
      { method: 'POST', signal: options?.signal },
    );
    const body = await readJson(res);
    return { deliveryId: body.delivery_id as string };
  }

  /**
   * Register an endpoint. Its signing `secret` is only ever returned here;
   * pass it to `webhooks.verifyRequest` in the receiver.
   */
  async create(
    input: CreateWebhookEndpointInput,
    options?: RequestOptions,
  ): Promise<CreatedWebhookEndpoint> {
    const res = await this._fetch('/api/v1/webhooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: input.url, events: input.events }),
      signal: options?.signal,
    });
    const body = await readJson(res);
    return {
      id: body.id as string,
      url: body.url as string,
      events: body.events as WebhookEventName[],
      secret: body.secret as string,
    };
  }

  /** Remove an endpoint. */
  async delete(endpointId: string, options?: RequestOptions): Promise<void> {
    await this._fetch(`/api/v1/webhooks/${encodeURIComponent(endpointId)}`, {
      method: 'DELETE',
      signal: options?.signal,
    });
  }

  /**
   * Send a signed `webhook.test` event to the endpoint now and report how the
   * receiver answered. The send is recorded with the deliveries.
   */
  async test(endpointId: string, options?: RequestOptions): Promise<WebhookTestResult> {
    const res = await this._fetch(`/api/v1/webhooks/${encodeURIComponent(endpointId)}/test`, {
      method: 'POST',
      signal: options?.signal,
    });
    const body = await readJson(res);
    return {
      delivered: body.delivered as boolean,
      statusCode: (body.status_code as number | null | undefined) ?? null,
      error: (body.error as string | null | undefined) ?? null,
    };
  }

  /** The endpoint's latest delivery attempts, newest first (`limit` 1 to 100, default 50). */
  async deliveries(
    endpointId: string,
    options?: { limit?: number; signal?: AbortSignal },
  ): Promise<WebhookDelivery[]> {
    const query = options?.limit != null ? `?limit=${encodeURIComponent(options.limit)}` : '';
    const res = await this._fetch(
      `/api/v1/webhooks/${encodeURIComponent(endpointId)}/deliveries${query}`,
      { signal: options?.signal },
    );
    const body = await readJson(res);
    return (body.data as Array<Record<string, unknown>>).map((raw) => ({
      id: raw.id as string,
      eventId: (raw.event_id as string | null | undefined) ?? null,
      event: raw.event as string,
      statusCode: (raw.status_code as number | null | undefined) ?? null,
      delivered: raw.delivered as boolean,
      error: (raw.error as string | null | undefined) ?? null,
      attempt: raw.attempt as number,
      createdAt: raw.created_at as string,
      payload: (raw.payload as Record<string, unknown> | undefined) ?? {},
      manual: raw.manual === true,
    }));
  }
}

function mapEndpoint(raw: Record<string, unknown>): WebhookEndpoint {
  return {
    id: raw.id as string,
    url: raw.url as string,
    events: raw.events as WebhookEventName[],
    isActive: raw.is_active as boolean,
    createdAt: raw.created_at as string,
    lastDeliveryAt: (raw.last_delivery_at as string | null | undefined) ?? null,
    lastDeliveryOk: (raw.last_delivery_ok as boolean | null | undefined) ?? null,
  };
}
