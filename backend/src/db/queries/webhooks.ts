import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '../../config/database.js';
import {
  webhookEndpoints,
  webhookDeliveries,
  type WebhookEndpoint,
  type NewWebhookEndpoint,
  type WebhookDelivery,
  type NewWebhookDelivery,
} from '../schema.js';

// ──────────────────────────────────────────
// Webhook Endpoints
// ──────────────────────────────────────────

/**
 * Register a new webhook endpoint.
 */
export async function createWebhookEndpoint(
  data: NewWebhookEndpoint,
): Promise<WebhookEndpoint> {
  const [endpoint] = await db
    .insert(webhookEndpoints)
    .values(data)
    .returning();
  return endpoint;
}

/**
 * Find a webhook endpoint by its primary key.
 */
export async function getWebhookEndpointById(
  id: string,
): Promise<WebhookEndpoint | undefined> {
  return db.query.webhookEndpoints.findFirst({
    where: eq(webhookEndpoints.id, id),
  });
}

/**
 * List all webhook endpoints for a given API key.
 */
export async function listWebhookEndpointsByApiKeyId(
  apiKeyId: string,
  opts?: { includeInactive?: boolean },
): Promise<WebhookEndpoint[]> {
  const conditions = [eq(webhookEndpoints.apiKeyId, apiKeyId)];
  if (!opts?.includeInactive) {
    conditions.push(eq(webhookEndpoints.isActive, true));
  }

  return db.query.webhookEndpoints.findMany({
    where: and(...conditions),
    orderBy: [desc(webhookEndpoints.createdAt)],
  });
}

/**
 * Find all active webhook endpoints subscribed to a given event type.
 * Used by the webhook dispatcher to determine delivery targets.
 */
export async function findEndpointsForEvent(
  eventType: string,
): Promise<WebhookEndpoint[]> {
  // SQL array containment: events @> ARRAY[eventType]
  const result = await db
    .select()
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.isActive, true),
        sql`${webhookEndpoints.events} @> ARRAY[${eventType}]::text[]`,
      ),
    );
  return result;
}

/**
 * Update a webhook endpoint.
 */
export async function updateWebhookEndpoint(
  id: string,
  data: Partial<
    Pick<WebhookEndpoint, 'url' | 'events' | 'secret' | 'isActive'>
  >,
): Promise<WebhookEndpoint | undefined> {
  const [updated] = await db
    .update(webhookEndpoints)
    .set(data)
    .where(eq(webhookEndpoints.id, id))
    .returning();
  return updated;
}

/**
 * Deactivate a webhook endpoint (soft-delete).
 */
export async function deactivateWebhookEndpoint(
  id: string,
): Promise<WebhookEndpoint | undefined> {
  const [updated] = await db
    .update(webhookEndpoints)
    .set({ isActive: false })
    .where(eq(webhookEndpoints.id, id))
    .returning();
  return updated;
}

/**
 * Permanently delete a webhook endpoint and all its delivery records.
 *
 * `apiKeyId` constrains the delete to the endpoint's owning key so one
 * caller cannot remove another's webhook by guessing its UUID.
 */
export async function deleteWebhookEndpoint(
  id: string,
  apiKeyId?: string,
): Promise<WebhookEndpoint | undefined> {
  const [deleted] = await db
    .delete(webhookEndpoints)
    .where(
      apiKeyId
        ? and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.apiKeyId, apiKeyId))
        : eq(webhookEndpoints.id, id),
    )
    .returning();
  return deleted;
}

// ──────────────────────────────────────────
// Webhook Deliveries
// ──────────────────────────────────────────

/**
 * Log a new webhook delivery attempt.
 */
export async function createWebhookDelivery(
  data: NewWebhookDelivery,
): Promise<WebhookDelivery> {
  const [delivery] = await db
    .insert(webhookDeliveries)
    .values(data)
    .returning();
  return delivery;
}

/**
 * Find a webhook delivery by its primary key.
 */
export async function getWebhookDeliveryById(
  id: string,
): Promise<WebhookDelivery | undefined> {
  return db.query.webhookDeliveries.findFirst({
    where: eq(webhookDeliveries.id, id),
  });
}

/**
 * List deliveries for a given webhook endpoint, ordered newest first.
 */
export async function listWebhookDeliveries(opts: {
  webhookEndpointId: string;
  limit?: number;
  offset?: number;
}): Promise<WebhookDelivery[]> {
  const { webhookEndpointId, limit = 50, offset = 0 } = opts;

  return db.query.webhookDeliveries.findMany({
    where: eq(webhookDeliveries.webhookEndpointId, webhookEndpointId),
    limit,
    offset,
    orderBy: [desc(webhookDeliveries.createdAt)],
  });
}

/**
 * Record the HTTP response of a delivery attempt.
 */
export async function updateWebhookDeliveryResult(
  id: string,
  data: {
    statusCode: number;
    responseBody?: string;
    deliveredAt: Date;
  },
): Promise<WebhookDelivery | undefined> {
  const [updated] = await db
    .update(webhookDeliveries)
    .set({
      statusCode: data.statusCode,
      responseBody: data.responseBody ?? null,
      deliveredAt: data.deliveredAt,
    })
    .where(eq(webhookDeliveries.id, id))
    .returning();
  return updated;
}

/**
 * Increment the retry count for a failed delivery.
 */
export async function incrementDeliveryRetryCount(
  id: string,
): Promise<WebhookDelivery | undefined> {
  const [updated] = await db
    .update(webhookDeliveries)
    .set({
      retryCount: sql`${webhookDeliveries.retryCount} + 1`,
    })
    .where(eq(webhookDeliveries.id, id))
    .returning();
  return updated;
}

/**
 * Delete a webhook delivery record by ID.
 */
export async function deleteWebhookDelivery(
  id: string,
): Promise<WebhookDelivery | undefined> {
  const [deleted] = await db
    .delete(webhookDeliveries)
    .where(eq(webhookDeliveries.id, id))
    .returning();
  return deleted;
}

/**
 * Count total deliveries grouped by status code for a given endpoint.
 * Useful for endpoint health monitoring.
 */
export async function countDeliveriesByStatusCode(
  webhookEndpointId: string,
): Promise<Record<string, number>> {
  const rows = await db
    .select({
      statusCode: webhookDeliveries.statusCode,
      count: sql<number>`count(*)::int`,
    })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.webhookEndpointId, webhookEndpointId))
    .groupBy(webhookDeliveries.statusCode);

  const result: Record<string, number> = {};
  for (const row of rows) {
    const key = row.statusCode?.toString() ?? 'pending';
    result[key] = row.count;
  }
  return result;
}
