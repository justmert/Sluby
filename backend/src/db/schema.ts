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
  index,
  uniqueIndex,
  primaryKey,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

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

export const accessTierEnum = pgEnum('access_tier', ['public', 'private']);

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
export const playbackPolicyEnum = pgEnum('playback_policy', ['public', 'signed']);

/** Outcome of a reconciliation run: matched, or drift was detected. */
export const reconcileStatusEnum = pgEnum('reconcile_status', ['ok', 'drift', 'failed']);

// ──────────────────────────────────────────
// Tables
// ──────────────────────────────────────────

/**
 * upload_sessions tracks the state of each TUS upload.
 * Created when a client initiates an upload, updated as chunks arrive,
 * and finalized when the full file has been received and verified.
 */
export const uploadSessions = pgTable(
  'upload_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    videoAssetId: uuid('video_asset_id').references(() => videoAssets.id, {
      onDelete: 'set null',
    }),
    uploadUrl: text('upload_url').notNull(),
    filePath: text('file_path').notNull(),
    fileSize: bigint('file_size', { mode: 'number' }).notNull(),
    uploadedBytes: bigint('uploaded_bytes', { mode: 'number' }).notNull().default(0),
    sha256Hash: text('sha256_hash'),
    status: uploadStatusEnum('status').notNull().default('uploading'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (t) => [
    // deletion looks sessions up by asset, and the foreign key's set null on
    // a hard delete would otherwise scan the table
    index('upload_sessions_video_asset_id_idx').on(t.videoAssetId),
    // the hourly source sweep matches files on disk to sessions by path
    index('upload_sessions_file_path_idx').on(t.filePath),
  ],
);

/**
 * video_assets stores local metadata for each video.
 * PostgreSQL is the source of truth for video metadata;
 * this table is a cache for fast queries and search.
 */
export const videoAssets = pgTable(
  'video_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    manifestObjectId: text('manifest_object_id'),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    durationMs: bigint('duration_ms', { mode: 'number' }).default(0),
    resolution: text('resolution').default(''),
    status: videoStatusEnum('status').notNull().default('created'),
    accessTier: accessTierEnum('access_tier').notNull().default('public'),
    creatorAddress: text('creator_address').notNull(),
    thumbnailObjectIds: text('thumbnail_object_ids').array().notNull().default([]),
    segmentCount: integer('segment_count').notNull().default(0),
    totalStorageBytes: bigint('total_storage_bytes', { mode: 'number' }).notNull().default(0),
    siaObjectIds: jsonb('sia_object_ids').$type<string[]>().default([]),
    // part of every signed url of the asset; raising it (on a tier change or
    // a revoke) makes every url signed before stop working
    signingGeneration: integer('signing_generation').notNull().default(0),
    // urls signed before generations existed (with the session secret
    // itself) are honoured until this time, set by migration 0014 for the
    // assets that existed then and cleared by the first raise of the
    // generation; null means none are
    legacySignaturesUntil: timestamp('legacy_signatures_until', { withTimezone: true }),
    // Soft-delete marker. When set, the asset is hidden from every API read
    // and a background worker unpins its Sia objects, then removes the row.
    // A non-null value means "deletion in progress"; the row is gone once the
    // objects are unpinned.
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    // millisecond precision, the precision of a js date and so of a listing
    // cursor, which lets the listing order and page on the plain column
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Every by-id API lookup is now owner-scoped, and listing filters on it.
    index('video_assets_creator_address_idx').on(t.creatorAddress),
    index('video_assets_status_idx').on(t.status),
    // the platform listing's sort key (created_at desc, id desc), read backwards
    index('video_assets_created_at_id_idx').on(t.createdAt, t.id),
    // a tenant's listing, read backwards too, so a page reads only the rows it
    // returns
    index('video_assets_owner_listing_idx')
      .on(t.creatorAddress, t.createdAt, t.id)
      .where(sql`${t.deletedAt} is null`),
    // Lets the deletion GC sweep find rows stuck mid-deletion cheaply.
    index('video_assets_deleted_at_idx').on(t.deletedAt),
  ],
);

/**
 * processing_jobs represents transcoding/upload/finalization jobs.
 * Managed by BullMQ; this table mirrors queue state for API queries
 * and durable audit.
 */
export const processingJobs = pgTable(
  'processing_jobs',
  {
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
    // automatic and manual retries of the asset's pipeline stages
    retryCount: integer('retry_count').notNull().default(0),
    logs: jsonb('logs')
      .$type<Array<{ timestamp: string; stage: string; message: string }>>()
      .default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('processing_jobs_video_asset_id_idx').on(t.videoAssetId),
    index('processing_jobs_upload_session_id_idx').on(t.uploadSessionId),
  ],
);

/**
 * renditions stores one row per quality level produced for an asset
 * (e.g. 1080p, 720p). Each rendition maps to its own Sia data object
 * (the single_file `data.m4s`) and its rewritten variant playlist.
 */
export const renditions = pgTable(
  'renditions',
  {
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('renditions_video_asset_id_idx').on(t.videoAssetId)],
);

/**
 * artifacts is the authoritative mapping between every stored Sia Object
 * ID and its parent asset, rendition (when applicable), and role. This is
 * what lets the platform reconcile against the indexer, render a per-asset
 * storage breakdown, and unpin precisely on delete. Every id in an asset's
 * manifest_object_id, thumbnail_object_ids and sia_object_ids has a row here
 * too: finalize writes these rows before the columns (every finalize job made
 * since this table exists carries them), and migration 0009 backfilled the
 * assets stored before it.
 */
export const artifacts = pgTable(
  'artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    videoAssetId: uuid('video_asset_id')
      .notNull()
      .references(() => videoAssets.id, { onDelete: 'cascade' }),
    renditionId: uuid('rendition_id').references(() => renditions.id, {
      onDelete: 'cascade',
    }),
    // null only for ids carried over from sia_object_ids of assets stored
    // before this table existed: a playlist or a data file, which the asset
    // row cannot tell apart
    role: artifactRoleEnum('role'),
    objectId: text('object_id').notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('artifacts_video_asset_id_idx').on(t.videoAssetId),
    index('artifacts_rendition_id_idx').on(t.renditionId),
    // The delivery gateway resolves an object's access tier by object id.
    index('artifacts_object_id_idx').on(t.objectId),
  ],
);

/**
 * What a pending object is waiting for: `uploading` while the run that pinned
 * it may still promote it to an artifact, `release` once nothing will and it
 * must be unpinned.
 */
export const pendingObjectStateEnum = pgEnum('pending_object_state', ['uploading', 'release']);

/**
 * pending_objects holds every Sia object the pipeline pins before finalize
 * records it in artifacts, written just before the pin, and every object that
 * is to be unpinned but has not been yet. No foreign key on purpose: a row has
 * to outlive its asset, since an upload can still pin after the asset row is
 * gone, and the deletion GC sweep unpins what is left here.
 */
export const pendingObjects = pgTable(
  'pending_objects',
  {
    objectId: text('object_id').primaryKey(),
    videoAssetId: uuid('video_asset_id').notNull(),
    // the processing run (transcode job id or retry id) that pinned it
    runKey: text('run_key').notNull(),
    state: pendingObjectStateEnum('state').notNull().default('uploading'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('pending_objects_video_asset_id_idx').on(t.videoAssetId),
    index('pending_objects_state_idx').on(t.state),
  ],
);

/**
 * playback_ids are public, rotatable handles that map to a video asset.
 * A creator can hand out a `pb_...` id (or several) for embedding and
 * revoke or rotate it without exposing or changing the internal asset
 * UUID — the same indirection Mux and other platforms use.
 */
export const playbackIds = pgTable(
  'playback_ids',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playbackId: text('playback_id').unique().notNull(),
    videoAssetId: uuid('video_asset_id')
      .notNull()
      .references(() => videoAssets.id, { onDelete: 'cascade' }),
    policy: playbackPolicyEnum('policy').notNull().default('public'),
    name: text('name').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('playback_ids_video_asset_id_idx').on(t.videoAssetId)],
);

/**
 * reconciliation_runs records each pass of the background worker that
 * compares PostgreSQL's tracked object ids against the indexer's pinned
 * inventory. Orphaned/missing ids are captured for operator review; the
 * worker never deletes automatically. Only the latest runs are kept
 * (RECONCILE_RUNS_KEPT), since each carries its full id lists.
 */
export const reconciliationRuns = pgTable(
  'reconciliation_runs',
  {
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
    /** Populated when status is 'failed' so outages are visible, not just logged. */
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // the latest run is read by finish time, and retention drops the oldest
  (t) => [index('reconciliation_runs_finished_at_idx').on(t.finishedAt)],
);

/**
 * indexer_objects is reconciliation's copy of the indexer's object inventory:
 * the latest event the indexer's object feed reported for each object id.
 * Each run reads only the events after reconcile_feed's cursor and applies
 * them here, instead of replaying the whole feed. Deleted objects are kept for
 * the grace window only, to tell a deletion in progress from a missing object.
 */
export const indexerObjects = pgTable('indexer_objects', {
  objectId: text('object_id').primaryKey(),
  deleted: boolean('deleted').notNull(),
  /** The indexer's updatedAt for the event, at the millisecond precision the SDK gives. */
  eventAt: timestamp('event_at', { withTimezone: true, precision: 3 }).notNull(),
});

/**
 * reconcile_feed is the one row naming the indexer feed indexer_objects was
 * built from and how far it has been read. A run against another feed
 * (another indexer url or account) starts the copy over.
 */
export const reconcileFeed = pgTable('reconcile_feed', {
  /** The indexer url and account key the inventory belongs to. */
  feed: text('feed').primaryKey(),
  /** Where the next run resumes the feed; null reads it from the start. */
  cursorId: text('cursor_id'),
  cursorAfter: timestamp('cursor_after', { withTimezone: true, precision: 3 }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * api_keys stores hashed developer API keys.
 * The raw key is shown only once at creation time; we store SHA-256
 * hashes for lookup.
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    keyHash: text('key_hash').unique().notNull(),
    name: text('name').notNull(),
    scopes: text('scopes').array().notNull().default([]),
    rateLimit: integer('rate_limit').notNull().default(100),
    creatorAddress: text('creator_address').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** The key that replaced this one in a rotation. A rotated key cannot be
     *  rotated again: rotate its replacement instead. */
    replacedById: uuid('replaced_by_id').references((): AnyPgColumn => apiKeys.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    index('api_keys_creator_address_idx').on(t.creatorAddress),
    // deleting a key clears this link on the key it replaced
    index('api_keys_replaced_by_id_idx').on(t.replacedById),
  ],
);

/**
 * users is one row per account. Everything an account owns carries the owner
 * address `user:<id>` (see api/ownership.ts), never a sign-in provider's
 * handle, so a renamed or recycled handle cannot move data between people.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  displayName: text('display_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * user_identities links an account to the ways it signs in. `subject` is the
 * provider's stable id for the person (github: the numeric account id), and
 * `username` the handle the provider reported at the last sign-in, kept for
 * display only.
 */
export const userIdentities = pgTable(
  'user_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    subject: text('subject').notNull(),
    username: text('username').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSignInAt: timestamp('last_sign_in_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('user_identities_provider_subject_key').on(t.provider, t.subject),
    index('user_identities_user_id_idx').on(t.userId),
  ],
);

/**
 * allowlist_pins ties a handle written in a provider's allowlist (a github
 * login) to the account that held it when it first signed in, so the entry
 * keeps admitting that account through renames and never admits whoever
 * claims the handle next.
 */
export const allowlistPins = pgTable(
  'allowlist_pins',
  {
    provider: text('provider').notNull(),
    entry: text('entry').notNull(),
    subject: text('subject').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.entry] }),
    index('allowlist_pins_provider_subject_idx').on(t.provider, t.subject),
  ],
);

/**
 * legacy_owner_claims records which account took over an owner address
 * written by older versions (`github:<login>`). An address is claimed at most
 * once, by the first account that signs in with that handle, and its rows are
 * moved to the account's own address in the same transaction.
 */
export const legacyOwnerClaims = pgTable(
  'legacy_owner_claims',
  {
    address: text('address').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('legacy_owner_claims_user_id_idx').on(t.userId)],
);

/**
 * studio_sessions holds one row per Studio sign-in. The session cookie only
 * carries the row id (signed), so a session can be ended server-side: on
 * sign-out, from the sessions list, or by taking the account off the
 * allowlist.
 */
export const studioSessions = pgTable(
  'studio_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // the identity the browser signed in with, shown as "signed in with ..."
    identityId: uuid('identity_id')
      .notNull()
      .references(() => userIdentities.id, { onDelete: 'cascade' }),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    index('studio_sessions_user_id_idx').on(t.userId),
    index('studio_sessions_identity_id_idx').on(t.identityId),
  ],
);

/**
 * webhook_endpoints stores registered webhook URLs for a given API key.
 * Each endpoint receives POST requests for subscribed event types.
 */
export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // the account the endpoint belongs to; events are only ever delivered for
    // that account's own assets
    creatorAddress: text('creator_address').notNull(),
    // the key it was registered with, when it was a key (null for a studio
    // session); kept for audit, not ownership, so revoking a key keeps the hook
    apiKeyId: uuid('api_key_id').references(() => apiKeys.id, { onDelete: 'set null' }),
    url: text('url').notNull(),
    events: text('events').array().notNull().default([]),
    secret: text('secret').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('webhook_endpoints_api_key_id_idx').on(t.apiKeyId),
    index('webhook_endpoints_creator_address_idx').on(t.creatorAddress),
  ],
);

/**
 * webhook_deliveries logs every webhook delivery attempt.
 * Used for debugging, retries, and auditing.
 */
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    webhookEndpointId: uuid('webhook_endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    statusCode: integer('status_code'),
    // why an attempt failed, in our own words; the receiver's response body is
    // never stored, so a delivery log cannot be used to read internal services
    error: text('error'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    retryCount: integer('retry_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // deleting an endpoint cascades here, and its deliveries list newest first
    index('webhook_deliveries_endpoint_created_at_idx').on(t.webhookEndpointId, t.createdAt),
  ],
);

// ──────────────────────────────────────────
// Relations
// ──────────────────────────────────────────

export const uploadSessionsRelations = relations(uploadSessions, ({ one }) => ({
  videoAsset: one(videoAssets, {
    fields: [uploadSessions.videoAssetId],
    references: [videoAssets.id],
  }),
}));

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

export const processingJobsRelations = relations(processingJobs, ({ one }) => ({
  videoAsset: one(videoAssets, {
    fields: [processingJobs.videoAssetId],
    references: [videoAssets.id],
  }),
  uploadSession: one(uploadSessions, {
    fields: [processingJobs.uploadSessionId],
    references: [uploadSessions.id],
  }),
}));

export const apiKeysRelations = relations(apiKeys, ({ many }) => ({
  webhookEndpoints: many(webhookEndpoints),
}));

export const webhookEndpointsRelations = relations(webhookEndpoints, ({ one, many }) => ({
  apiKey: one(apiKeys, {
    fields: [webhookEndpoints.apiKeyId],
    references: [apiKeys.id],
  }),
  deliveries: many(webhookDeliveries),
}));

export const webhookDeliveriesRelations = relations(webhookDeliveries, ({ one }) => ({
  webhookEndpoint: one(webhookEndpoints, {
    fields: [webhookDeliveries.webhookEndpointId],
    references: [webhookEndpoints.id],
  }),
}));

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
export type PendingObject = typeof pendingObjects.$inferSelect;
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

export type StudioSession = typeof studioSessions.$inferSelect;

export type User = typeof users.$inferSelect;
export type UserIdentity = typeof userIdentities.$inferSelect;
