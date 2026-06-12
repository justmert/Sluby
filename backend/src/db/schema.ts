import {
  pgTable,
  uuid,
  text,
  bigint,
  integer,
  boolean,
  timestamp,
  jsonb,
  pgEnum,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// ──────────────────────────────────────────
// Enums
// ──────────────────────────────────────────

export const uploadStatusEnum = pgEnum('upload_status', [
  'uploading',
  'completed',
  'cancelled',
  'failed',
]);

export const videoStatusEnum = pgEnum('video_status', [
  'created',
  'uploading',
  'processing',
  'ready',
  'failed',
]);

export const accessTierEnum = pgEnum('access_tier', [
  'public',
  'private',
]);

export const jobStatusEnum = pgEnum('job_status', [
  'queued',
  'processing',
  'completed',
  'failed',
  'retrying',
]);

// ──────────────────────────────────────────
// Tables
// ──────────────────────────────────────────

/**
 * upload_sessions tracks the state of each TUS upload.
 * Created when a client initiates an upload, updated as chunks arrive,
 * and finalized when the full file has been received and verified.
 */
export const uploadSessions = pgTable('upload_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  videoAssetId: uuid('video_asset_id').references(() => videoAssets.id, {
    onDelete: 'set null',
  }),
  uploadUrl: text('upload_url').notNull(),
  filePath: text('file_path').notNull(),
  fileSize: bigint('file_size', { mode: 'number' }).notNull(),
  uploadedBytes: bigint('uploaded_bytes', { mode: 'number' })
    .notNull()
    .default(0),
  sha256Hash: text('sha256_hash'),
  status: uploadStatusEnum('status').notNull().default('uploading'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
});

/**
 * video_assets stores local metadata for each video.
 * PostgreSQL is the source of truth for video metadata;
 * this table is a cache for fast queries and search.
 */
export const videoAssets = pgTable('video_assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  manifestObjectId: text('manifest_object_id'),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  durationMs: bigint('duration_ms', { mode: 'number' }).default(0),
  resolution: text('resolution').default(''),
  status: videoStatusEnum('status').notNull().default('created'),
  accessTier: accessTierEnum('access_tier').notNull().default('public'),
  creatorAddress: text('creator_address').notNull(),
  thumbnailObjectIds: text('thumbnail_object_ids')
    .array()
    .notNull()
    .default([]),
  segmentCount: integer('segment_count').notNull().default(0),
  totalStorageBytes: bigint('total_storage_bytes', { mode: 'number' })
    .notNull()
    .default(0),
  siaObjectIds: jsonb('sia_object_ids').$type<string[]>().default([]),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * processing_jobs represents transcoding/upload/finalization jobs.
 * Managed by BullMQ; this table mirrors queue state for API queries
 * and durable audit.
 */
export const processingJobs = pgTable('processing_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  videoAssetId: uuid('video_asset_id')
    .notNull()
    .references(() => videoAssets.id, { onDelete: 'cascade' }),
  uploadSessionId: uuid('upload_session_id')
    .notNull()
    .references(() => uploadSessions.id, { onDelete: 'cascade' }),
  status: jobStatusEnum('status').notNull().default('queued'),
  progressPercent: integer('progress_percent').notNull().default(0),
  errorMessage: text('error_message'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  retryCount: integer('retry_count').notNull().default(0),
  maxRetries: integer('max_retries').notNull().default(3),
  logs: jsonb('logs').$type<Array<{ timestamp: string; stage: string; message: string }>>().default([]),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * api_keys stores hashed developer API keys.
 * The raw key is shown only once at creation time; we store SHA-256
 * hashes for lookup.
 */
export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  keyHash: text('key_hash').unique().notNull(),
  name: text('name').notNull(),
  scopes: text('scopes').array().notNull().default([]),
  rateLimit: integer('rate_limit').notNull().default(100),
  creatorAddress: text('creator_address').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
});

/**
 * webhook_endpoints stores registered webhook URLs for a given API key.
 * Each endpoint receives POST requests for subscribed event types.
 */
export const webhookEndpoints = pgTable('webhook_endpoints', {
  id: uuid('id').primaryKey().defaultRandom(),
  apiKeyId: uuid('api_key_id')
    .notNull()
    .references(() => apiKeys.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  events: text('events').array().notNull().default([]),
  secret: text('secret').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * webhook_deliveries logs every webhook delivery attempt.
 * Used for debugging, retries, and auditing.
 */
export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: uuid('id').primaryKey().defaultRandom(),
  webhookEndpointId: uuid('webhook_endpoint_id')
    .notNull()
    .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  statusCode: integer('status_code'),
  responseBody: text('response_body'),
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  retryCount: integer('retry_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * allowlists tracks Seal allowlists created on-chain for private video access.
 * Each allowlist is linked to a video asset and has a corresponding Sia object.
 */
export const allowlists = pgTable('allowlists', {
  id: uuid('id').primaryKey().defaultRandom(),
  videoAssetId: uuid('video_asset_id')
    .notNull()
    .references(() => videoAssets.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  creatorAddress: text('creator_address').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * allowlist_members stores addresses that have been added to an allowlist.
 */
export const allowlistMembers = pgTable('allowlist_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  allowlistId: uuid('allowlist_id')
    .notNull()
    .references(() => allowlists.id, { onDelete: 'cascade' }),
  address: text('address').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [
  uniqueIndex('allowlist_members_allowlist_address_idx').on(table.allowlistId, table.address),
]);

/**
 * subscriptions tracks time-limited subscription passes created on-chain.
 */
export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  subscriberAddress: text('subscriber_address').notNull(),
  creatorAddress: text('creator_address').notNull(),
  tier: integer('tier').notNull().default(0),
  durationDays: integer('duration_days').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * viewing_tickets tracks single-use viewing tickets created on-chain.
 */
export const viewingTickets = pgTable('viewing_tickets', {
  id: uuid('id').primaryKey().defaultRandom(),
  viewerAddress: text('viewer_address').notNull(),
  videoAssetId: uuid('video_asset_id')
    .notNull()
    .references(() => videoAssets.id, { onDelete: 'cascade' }),
  creatorAddress: text('creator_address').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ──────────────────────────────────────────
// Relations
// ──────────────────────────────────────────

export const uploadSessionsRelations = relations(
  uploadSessions,
  ({ one }) => ({
    videoAsset: one(videoAssets, {
      fields: [uploadSessions.videoAssetId],
      references: [videoAssets.id],
    }),
  }),
);

export const videoAssetsRelations = relations(videoAssets, ({ many }) => ({
  uploadSessions: many(uploadSessions),
  processingJobs: many(processingJobs),
}));

export const processingJobsRelations = relations(
  processingJobs,
  ({ one }) => ({
    videoAsset: one(videoAssets, {
      fields: [processingJobs.videoAssetId],
      references: [videoAssets.id],
    }),
    uploadSession: one(uploadSessions, {
      fields: [processingJobs.uploadSessionId],
      references: [uploadSessions.id],
    }),
  }),
);

export const apiKeysRelations = relations(apiKeys, ({ many }) => ({
  webhookEndpoints: many(webhookEndpoints),
}));

export const webhookEndpointsRelations = relations(
  webhookEndpoints,
  ({ one, many }) => ({
    apiKey: one(apiKeys, {
      fields: [webhookEndpoints.apiKeyId],
      references: [apiKeys.id],
    }),
    deliveries: many(webhookDeliveries),
  }),
);

export const webhookDeliveriesRelations = relations(
  webhookDeliveries,
  ({ one }) => ({
    webhookEndpoint: one(webhookEndpoints, {
      fields: [webhookDeliveries.webhookEndpointId],
      references: [webhookEndpoints.id],
    }),
  }),
);

export const allowlistsRelations = relations(allowlists, ({ one, many }) => ({
  videoAsset: one(videoAssets, {
    fields: [allowlists.videoAssetId],
    references: [videoAssets.id],
  }),
  members: many(allowlistMembers),
}));

export const allowlistMembersRelations = relations(
  allowlistMembers,
  ({ one }) => ({
    allowlist: one(allowlists, {
      fields: [allowlistMembers.allowlistId],
      references: [allowlists.id],
    }),
  }),
);

export const subscriptionsRelations = relations(subscriptions, () => ({}));

export const viewingTicketsRelations = relations(
  viewingTickets,
  ({ one }) => ({
    videoAsset: one(videoAssets, {
      fields: [viewingTickets.videoAssetId],
      references: [videoAssets.id],
    }),
  }),
);

// ──────────────────────────────────────────
// Type exports for use in queries
// ──────────────────────────────────────────

export type UploadSession = typeof uploadSessions.$inferSelect;
export type NewUploadSession = typeof uploadSessions.$inferInsert;

export type VideoAsset = typeof videoAssets.$inferSelect;
export type NewVideoAsset = typeof videoAssets.$inferInsert;

export type ProcessingJob = typeof processingJobs.$inferSelect;
export type NewProcessingJob = typeof processingJobs.$inferInsert;

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;
export type NewWebhookEndpoint = typeof webhookEndpoints.$inferInsert;

export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert;

export type Allowlist = typeof allowlists.$inferSelect;
export type NewAllowlist = typeof allowlists.$inferInsert;

export type AllowlistMember = typeof allowlistMembers.$inferSelect;
export type NewAllowlistMember = typeof allowlistMembers.$inferInsert;

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;

export type ViewingTicket = typeof viewingTickets.$inferSelect;
export type NewViewingTicket = typeof viewingTickets.$inferInsert;
