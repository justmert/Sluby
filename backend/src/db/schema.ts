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

/** Role of a stored Sia object within an asset's HLS output. */
export const artifactRoleEnum = pgEnum('artifact_role', [
  'master_manifest',
  'variant_playlist',
  'rendition_data',
  'thumbnail',
]);

/**
 * How a playback ID grants access. `public` streams openly; `signed`
 * requires a time-limited signed URL. Lets a creator revoke or rotate a
 * public handle without touching the underlying asset.
 */
export const playbackPolicyEnum = pgEnum('playback_policy', [
  'public',
  'signed',
]);

/** Outcome of a reconciliation run: matched, or drift was detected. */
export const reconcileStatusEnum = pgEnum('reconcile_status', [
  'ok',
  'drift',
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
 * renditions stores one row per quality level produced for an asset
 * (e.g. 1080p, 720p). Each rendition maps to its own Sia data object
 * (the single_file `data.m4s`) and its rewritten variant playlist.
 */
export const renditions = pgTable('renditions', {
  id: uuid('id').primaryKey().defaultRandom(),
  videoAssetId: uuid('video_asset_id')
    .notNull()
    .references(() => videoAssets.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  width: integer('width'),
  height: integer('height'),
  videoBitrateKbps: integer('video_bitrate_kbps'),
  segmentCount: integer('segment_count').notNull().default(0),
  byteSize: bigint('byte_size', { mode: 'number' }).notNull().default(0),
  dataObjectId: text('data_object_id').notNull(),
  playlistObjectId: text('playlist_object_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * artifacts is the authoritative mapping between every stored Sia Object
 * ID and its parent asset, rendition (when applicable), and role. This is
 * what lets the platform reconcile against the indexer, render a per-asset
 * storage breakdown, and unpin precisely on delete.
 */
export const artifacts = pgTable('artifacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  videoAssetId: uuid('video_asset_id')
    .notNull()
    .references(() => videoAssets.id, { onDelete: 'cascade' }),
  renditionId: uuid('rendition_id').references(() => renditions.id, {
    onDelete: 'cascade',
  }),
  role: artifactRoleEnum('role').notNull(),
  objectId: text('object_id').notNull(),
  byteSize: bigint('byte_size', { mode: 'number' }).notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * playback_ids are public, rotatable handles that map to a video asset.
 * A creator can hand out a `pb_...` id (or several) for embedding and
 * revoke or rotate it without exposing or changing the internal asset
 * UUID — the same indirection Mux and other platforms use.
 */
export const playbackIds = pgTable('playback_ids', {
  id: uuid('id').primaryKey().defaultRandom(),
  playbackId: text('playback_id').unique().notNull(),
  videoAssetId: uuid('video_asset_id')
    .notNull()
    .references(() => videoAssets.id, { onDelete: 'cascade' }),
  policy: playbackPolicyEnum('policy').notNull().default('public'),
  name: text('name').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * reconciliation_runs records each pass of the background worker that
 * compares PostgreSQL's tracked object ids against the indexer's pinned
 * inventory. Orphaned/missing ids are captured for operator review; the
 * worker never deletes automatically.
 */
export const reconciliationRuns = pgTable('reconciliation_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }).notNull(),
  status: reconcileStatusEnum('status').notNull(),
  dbObjectCount: integer('db_object_count').notNull().default(0),
  indexerObjectCount: integer('indexer_object_count').notNull().default(0),
  inSyncCount: integer('in_sync_count').notNull().default(0),
  orphanCount: integer('orphan_count').notNull().default(0),
  missingCount: integer('missing_count').notNull().default(0),
  orphanedIds: jsonb('orphaned_ids').$type<string[]>().notNull().default([]),
  missingIds: jsonb('missing_ids').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true })
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
  renditions: many(renditions),
  artifacts: many(artifacts),
  playbackIds: many(playbackIds),
}));

export const playbackIdsRelations = relations(playbackIds, ({ one }) => ({
  videoAsset: one(videoAssets, {
    fields: [playbackIds.videoAssetId],
    references: [videoAssets.id],
  }),
}));

export const renditionsRelations = relations(renditions, ({ one, many }) => ({
  videoAsset: one(videoAssets, {
    fields: [renditions.videoAssetId],
    references: [videoAssets.id],
  }),
  artifacts: many(artifacts),
}));

export const artifactsRelations = relations(artifacts, ({ one }) => ({
  videoAsset: one(videoAssets, {
    fields: [artifacts.videoAssetId],
    references: [videoAssets.id],
  }),
  rendition: one(renditions, {
    fields: [artifacts.renditionId],
    references: [renditions.id],
  }),
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

// ──────────────────────────────────────────
// Type exports for use in queries
// ──────────────────────────────────────────

export type UploadSession = typeof uploadSessions.$inferSelect;
export type NewUploadSession = typeof uploadSessions.$inferInsert;

export type VideoAsset = typeof videoAssets.$inferSelect;
export type NewVideoAsset = typeof videoAssets.$inferInsert;

export type ProcessingJob = typeof processingJobs.$inferSelect;
export type NewProcessingJob = typeof processingJobs.$inferInsert;

export type Rendition = typeof renditions.$inferSelect;
export type NewRendition = typeof renditions.$inferInsert;

export type Artifact = typeof artifacts.$inferSelect;
export type NewArtifact = typeof artifacts.$inferInsert;

export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;

export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;
export type NewWebhookEndpoint = typeof webhookEndpoints.$inferInsert;

export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert;

export type PlaybackId = typeof playbackIds.$inferSelect;
export type NewPlaybackId = typeof playbackIds.$inferInsert;

export type ReconciliationRun = typeof reconciliationRuns.$inferSelect;
export type NewReconciliationRun = typeof reconciliationRuns.$inferInsert;

