import { eq, and, desc, lt, sql } from 'drizzle-orm';
import { db } from '../../config/database.js';
import {
  webhookEndpoints,
  webhookDeliveries,
  type WebhookEndpoint,
  type NewWebhookEndpoint,
  type WebhookDelivery,
  type NewWebhookDelivery,
} from '../schema.js';

/**
 * Register a new webhook endpoint.
 */
export async function createWebhookEndpoint(data: NewWebhookEndpoint): Promise<WebhookEndpoint> {
  const [endpoint] = await db.insert(webhookEndpoints).values(data).returning();
  return endpoint;
}

/**
 * Find a webhook endpoint by its primary key.
 */
export async function getWebhookEndpointById(id: string): Promise<WebhookEndpoint | undefined> {
  return db.query.webhookEndpoints.findFirst({
    where: eq(webhookEndpoints.id, id),
  });
}

/**
 * List an account's webhook endpoints. `creatorAddress` undefined lists every
 * account's (the platform identity, see ownerFilter).
 */
export async function listWebhookEndpointsByOwner(
  creatorAddress: string | undefined,
): Promise<WebhookEndpoint[]> {
  const conditions = [eq(webhookEndpoints.isActive, true)];
  if (creatorAddress !== undefined) {
    conditions.push(eq(webhookEndpoints.creatorAddress, creatorAddress));
  }

  return db.query.webhookEndpoints.findMany({
    where: and(...conditions),
    orderBy: [desc(webhookEndpoints.createdAt)],
  });
}

/**
 * Active endpoints of one account subscribed to an event. Events are only
 * ever delivered to the account that owns the asset they describe.
 */
export async function findEndpointsForEvent(
  eventType: string,
  creatorAddress: string,
): Promise<WebhookEndpoint[]> {
  // SQL array containment: events @> ARRAY[eventType]
  return db
    .select()
    .from(webhookEndpoints)
    .where(
      and(
        eq(webhookEndpoints.isActive, true),
        eq(webhookEndpoints.creatorAddress, creatorAddress),
        sql`${webhookEndpoints.events} @> ARRAY[${eventType}]::text[]`,
      ),
    );
}

/** One endpoint of an account, or undefined when it is not theirs. */
export async function getWebhookEndpointForOwner(
  id: string,
  creatorAddress: string | undefined,
): Promise<WebhookEndpoint | undefined> {
  return db.query.webhookEndpoints.findFirst({
    // an empty string scopes to '' like everywhere else, only undefined widens
    where:
      creatorAddress !== undefined
        ? and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.creatorAddress, creatorAddress))
        : eq(webhookEndpoints.id, id),
  });
}

/**
 * Permanently delete a webhook endpoint and all its delivery records.
 *
 * `creatorAddress` constrains the delete to the owning account so one caller
 * cannot remove another's webhook by guessing its UUID; undefined is the
 * platform identity (see ownerFilter).
 */
export async function deleteWebhookEndpoint(
  id: string,
  creatorAddress: string | undefined,
): Promise<WebhookEndpoint | undefined> {
  const [deleted] = await db
    .delete(webhookEndpoints)
    .where(
      creatorAddress !== undefined
        ? and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.creatorAddress, creatorAddress))
        : eq(webhookEndpoints.id, id),
    )
    .returning();
  return deleted;
}

/**
 * Log a new webhook delivery attempt.
 */
export async function createWebhookDelivery(data: NewWebhookDelivery): Promise<WebhookDelivery> {
  const [delivery] = await db.insert(webhookDeliveries).values(data).returning();
  return delivery;
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
 * Delete delivery log rows older than `olderThan`. Every attempt adds a row
 * and nothing else removes them while the endpoint lives, so without this the
 * table only grows. Returns how many went.
 */
export async function pruneWebhookDeliveries(olderThan: Date): Promise<number> {
  const deleted = await db
    .delete(webhookDeliveries)
    .where(lt(webhookDeliveries.createdAt, olderThan))
    .returning({ id: webhookDeliveries.id });
  return deleted.length;
}
