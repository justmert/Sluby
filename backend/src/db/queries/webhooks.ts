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

/** An endpoint with how its newest delivery attempt went. */
export interface WebhookEndpointWithHealth extends WebhookEndpoint {
  /** When the newest attempt was made; null before the first. */
  lastDeliveryAt: Date | null;
  /** Whether the newest attempt was delivered; null before the first. */
  lastDeliveryOk: boolean | null;
}

// the newest delivery row of each endpoint, read through the
// (webhook_endpoint_id, created_at) index one row per endpoint
function selectWithHealth() {
  const last = db
    .select({
      createdAt: webhookDeliveries.createdAt,
      deliveredAt: webhookDeliveries.deliveredAt,
    })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.webhookEndpointId, webhookEndpoints.id))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(1)
    .as('last_delivery');
  return db
    .select({
      endpoint: webhookEndpoints,
      lastDeliveryAt: last.createdAt,
      lastDeliveredAt: last.deliveredAt,
    })
    .from(webhookEndpoints)
    .leftJoinLateral(last, sql`true`);
}

function withHealth(row: {
  endpoint: WebhookEndpoint;
  lastDeliveryAt: Date | null;
  lastDeliveredAt: Date | null;
}): WebhookEndpointWithHealth {
  return {
    ...row.endpoint,
    lastDeliveryAt: row.lastDeliveryAt,
    lastDeliveryOk: row.lastDeliveryAt === null ? null : row.lastDeliveredAt !== null,
  };
}

/**
 * List an account's webhook endpoints, paused ones included, newest first.
 * `creatorAddress` undefined lists every account's (the platform identity,
 * see ownerFilter).
 */
export async function listWebhookEndpointsByOwner(
  creatorAddress: string | undefined,
): Promise<WebhookEndpointWithHealth[]> {
  const rows = await selectWithHealth()
    .where(
      creatorAddress !== undefined
        ? eq(webhookEndpoints.creatorAddress, creatorAddress)
        : undefined,
    )
    .orderBy(desc(webhookEndpoints.createdAt), desc(webhookEndpoints.id));
  return rows.map(withHealth);
}

/** One endpoint of an account with its delivery health, or undefined when it is not theirs. */
export async function getWebhookEndpointWithHealth(
  id: string,
  creatorAddress: string | undefined,
): Promise<WebhookEndpointWithHealth | undefined> {
  const [row] = await selectWithHealth().where(
    creatorAddress !== undefined
      ? and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.creatorAddress, creatorAddress))
      : eq(webhookEndpoints.id, id),
  );
  return row && withHealth(row);
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
 * Change an endpoint's url, events or whether it is active. Owner-scoped like
 * deletion; undefined when the endpoint is not the account's.
 */
export async function updateWebhookEndpoint(
  id: string,
  creatorAddress: string | undefined,
  patch: Partial<Pick<NewWebhookEndpoint, 'url' | 'events' | 'isActive'>>,
): Promise<WebhookEndpoint | undefined> {
  return updateWebhookEndpointRow(id, creatorAddress, patch);
}

async function updateWebhookEndpointRow(
  id: string,
  creatorAddress: string | undefined,
  patch: Partial<Pick<NewWebhookEndpoint, 'url' | 'events' | 'isActive' | 'secret'>>,
): Promise<WebhookEndpoint | undefined> {
  const [updated] = await db
    .update(webhookEndpoints)
    .set(patch)
    .where(
      creatorAddress !== undefined
        ? and(eq(webhookEndpoints.id, id), eq(webhookEndpoints.creatorAddress, creatorAddress))
        : eq(webhookEndpoints.id, id),
    )
    .returning();
  return updated;
}

/**
 * Replace an endpoint's signing secret. Deliveries read the secret when they
 * are sent, so queued retries are signed with the new one and the old one
 * stops at once. Undefined when the endpoint is not the account's.
 */
export async function setWebhookSecret(
  id: string,
  creatorAddress: string | undefined,
  secret: string,
): Promise<WebhookEndpoint | undefined> {
  return updateWebhookEndpointRow(id, creatorAddress, { secret });
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
