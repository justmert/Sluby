import 'express-async-errors';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import pino from 'pino';
import { mkdirSync, readFileSync } from 'node:fs';
import { env } from './config/env.js';
import { db } from './config/database.js';
import { closeDatabase } from './config/database.js';
import {
  closeQueues,
  transcodeQueue,
  uploadSegmentsQueue,
  finalizeQueue,
  deletionQueue,
} from './queue/bull-config.js';
import { closeWorkers } from './queue/processors.js';

// ── Real module imports ──

import { createApiRouter, type ApiRouterDeps } from './api/router.js';
import { createTusServer, type TusServerDeps } from './upload/tus-server.js';
import { sweepExpiredUploads, UPLOAD_SWEEP_INTERVAL_MS } from './upload/upload-store.js';
import { isTusRequest } from './upload/tus-dispatch.js';
import { buildSignedObjectQuery } from './delivery/signed-url.js';
import { createAssetShareUrls } from './delivery/share-urls.js';
import { deliveryRouter } from './delivery/aggregator.js';
import { setMetricSources } from './metrics/collector.js';
import { createHealthHandler, createPrometheusHandler } from './api/service-routes.js';
import { createErrorHandler, notFoundHandler } from './api/middleware/error-handler.js';

// DB query imports
import {
  createUploadSession as dbCreateUploadSession,
  getUploadSessionById,
  updateUploadSession,
} from './db/queries/uploads.js';

import {
  createVideoAsset,
  getVideoAssetById,
  listVideoAssets,
  updateVideoAsset,
  softDeleteVideoAsset,
  getAssetObjectIds,
} from './db/queries/assets.js';
import { getObjectAccessTier, invalidateObjectAccessTier } from './delivery/access-control.js';

import {
  createProcessingJob,
  getProcessingJobByVideoAssetId,
  updateProcessingJobStatus,
} from './db/queries/jobs.js';

import {
  validateApiKey as dbValidateApiKey,
  getApiKeyByHash,
  listApiKeys as dbListApiKeys,
  deleteApiKey as dbDeleteApiKey,
  rotateApiKey as dbRotateApiKey,
} from './db/queries/api-keys.js';

import { apiKeys as apiKeysTable, type VideoAsset } from './db/schema.js';
import { BOOTSTRAP_CREATOR_ADDRESS, seedBootstrapApiKey } from './db/api-key-seeding.js';

import {
  createWebhookEndpoint,
  listWebhookEndpointsByOwner,
  deleteWebhookEndpoint,
  findEndpointsForEvent,
  createWebhookDelivery,
} from './db/queries/webhooks.js';

import {
  createPlaybackIdForAsset,
  listPlaybackIdsByAsset,
  deletePlaybackIdByPublicId,
  resolveAssetId,
} from './db/queries/playback-ids.js';

import {
  createStudioSession,
  findActiveStudioSession,
  listActiveStudioSessions,
  pruneStudioSessions,
  revokeAllStudioSessions,
  revokeStudioSession,
} from './db/queries/sessions.js';
import { getLatestReconciliationRun, filterObjectIdsOwnedBy } from './db/queries/reconciliation.js';
import { getAssetStats } from './db/queries/stats.js';
import { createCachedSystemStatus } from './system/status.js';
import {
  getClient,
  getAccountInfo,
  listHosts,
  inspectObject,
  getHostContracts,
  getWalletAddress,
} from './storage/sia-client.js';
import { getArtifacts, getRenditions } from './db/queries/storage-records.js';
import { getCacheStats } from './storage/blob-manager.js';
import { sql } from 'drizzle-orm';

import {
  scheduleReconciliation,
  triggerReconciliation,
  closeReconcileWorker,
} from './reconcile/worker.js';

// Importing the deletion worker module starts its BullMQ worker (same
// in-process model as the transcode/reconcile workers).
import { scheduleDeletionGc, closeDeletionWorker } from './deletion/worker.js';
import { buildDeleteAsset } from './deletion/service.js';
import { buildRetryAsset } from './queue/retry.js';

// Other imports
import { SessionManager } from './upload/session-manager.js';
import { WebhookDispatcher } from './webhooks/dispatcher.js';

// ──────────────────────────────────────────
// Logger
// ──────────────────────────────────────────

export const logger = pino({
  name: 'sluby',
  level: process.env.LOG_LEVEL || 'info',
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

// ──────────────────────────────────────────
// Ensure required directories exist
// ──────────────────────────────────────────

for (const dir of [env.UPLOAD_DIR, env.TRANSCODE_OUTPUT_DIR]) {
  mkdirSync(dir, { recursive: true });
}

// ──────────────────────────────────────────
// Webhook Dispatcher
// ──────────────────────────────────────────

const webhookDispatcher = new WebhookDispatcher({
  getActiveWebhooksForEvent: async (event: string, owner: string) => {
    const endpoints = await findEndpointsForEvent(event, owner);
    return endpoints.map((ep) => ({
      id: ep.id,
      url: ep.url,
      events: ep.events,
      secret: ep.secret,
      isActive: ep.isActive,
    }));
  },
  recordDelivery: async (data) => {
    await createWebhookDelivery({
      webhookEndpointId: data.webhookEndpointId,
      eventType: data.eventType,
      payload: data.payload,
      statusCode: data.statusCode,
      responseBody: data.responseBody,
      retryCount: data.retryCount,
    });
  },
});

// ──────────────────────────────────────────
// Session Manager
// ──────────────────────────────────────────

const sessionManager = new SessionManager({
  insertSession: async (session) => {
    await dbCreateUploadSession({
      id: session.id,
      videoAssetId: session.videoAssetId,
      uploadUrl: session.uploadUrl,
      filePath: session.filePath ?? '',
      fileSize: session.fileSize,
      uploadedBytes: session.uploadedBytes,
      sha256Hash: session.sha256Hash,
      status: session.status,
      metadata: session.metadata,
      expiresAt: session.expiresAt,
    });
  },
  getSession: async (id) => {
    const session = await getUploadSessionById(id);
    if (!session) return null;
    return {
      id: session.id,
      videoAssetId: session.videoAssetId,
      uploadUrl: session.uploadUrl,
      filePath: session.filePath,
      fileSize: session.fileSize,
      uploadedBytes: session.uploadedBytes,
      sha256Hash: session.sha256Hash,
      status: session.status as 'uploading' | 'completed' | 'cancelled' | 'failed',
      metadata: (session.metadata ?? {}) as Record<string, string>,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      expiresAt: session.expiresAt!,
    };
  },
  updateSession: async (id, data) => {
    // Convert nulls to undefined for fields that don't accept null in the DB update
    const adapted: Parameters<typeof updateUploadSession>[1] = {};
    if (data.videoAssetId !== undefined) adapted.videoAssetId = data.videoAssetId;
    if (data.uploadUrl !== undefined) adapted.uploadUrl = data.uploadUrl;
    if (data.filePath !== undefined) adapted.filePath = data.filePath ?? undefined;
    if (data.fileSize !== undefined) adapted.fileSize = data.fileSize;
    if (data.uploadedBytes !== undefined) adapted.uploadedBytes = data.uploadedBytes;
    if (data.sha256Hash !== undefined) adapted.sha256Hash = data.sha256Hash;
    if (data.status !== undefined) adapted.status = data.status;
    if (data.metadata !== undefined) adapted.metadata = data.metadata;
    if (data.expiresAt !== undefined) adapted.expiresAt = data.expiresAt;
    await updateUploadSession(id, adapted);
  },
});

// ──────────────────────────────────────────
// Express App
// ──────────────────────────────────────────

const app = express();

// The shipped stack puts nginx in front of the backend (docker-compose), so
// trust exactly one proxy hop. Without this, req.ip is the proxy's address
// rather than the client's, which skews request logs.
app.set('trust proxy', 1);

// ── Global Middleware ──

app.use(
  cors({
    // When credentials: true, origin cannot be '*'. Use a callback that reflects
    // the request origin (or restrict to specific domains via CORS_ORIGIN env var).
    origin: (origin, callback) => {
      const allowed = process.env.CORS_ORIGIN;
      if (allowed && allowed !== '*') {
        // Support comma-separated list of allowed origins
        const origins = allowed.split(',').map((o) => o.trim());
        callback(null, origins.includes(origin ?? '') ? origin : false);
      } else {
        // Development: allow any origin by reflecting it back
        callback(null, origin ?? true);
      }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Tus-Resumable',
      'Upload-Length',
      'Upload-Offset',
      'Upload-Metadata',
      'Upload-Concat',
      'Upload-Defer-Length',
      'X-Requested-With',
      'X-HTTP-Method-Override',
    ],
    exposedHeaders: [
      'Upload-Offset',
      'Upload-Length',
      'Upload-Metadata',
      'Tus-Version',
      'Tus-Resumable',
      'Tus-Max-Size',
      'Tus-Extension',
      'Location',
      'X-Request-Id',
    ],
    credentials: true,
  }),
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.info({ method: req.method, url: req.url }, 'incoming request');
  next();
});

// ── Health Check ──

// read from package.json rather than npm_package_version, which is only set
// when the process is started through npm
const APP_VERSION = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;
const STARTED_AT = new Date();

app.get('/health', createHealthHandler(APP_VERSION));

// ──────────────────────────────────────────
// TUS Upload Handler
// ──────────────────────────────────────────

// Soft-delete the asset (it vanishes from the API immediately), capture its
// Sia object ids, and enqueue the async unpin-and-remove job. Shared by the
// assets route and by tus when an uploader cancels.
const deleteAsset = buildDeleteAsset({
  softDelete: (id, owner) => softDeleteVideoAsset(id, owner),
  enqueue: async (videoAssetId) => {
    await deletionQueue.add(
      'delete',
      { kind: 'delete', videoAssetId },
      { jobId: `delete-${videoAssetId}` },
    );
  },
});

const tusServerDeps: TusServerDeps = {
  findActiveSession: findActiveStudioSession,
  validateApiKey: async (token: string) => {
    const apiKey = await dbValidateApiKey(token);
    if (!apiKey) return null;
    return {
      id: apiKey.id,
      creatorAddress: apiKey.creatorAddress,
      scopes: apiKey.scopes,
    };
  },

  createUploadSession: async (data) => {
    // Create a video asset for this upload
    const videoAsset = await createVideoAsset({
      title: data.metadata.title ?? 'Untitled',
      description: data.metadata.description ?? '',
      creatorAddress: data.metadata.creatorAddress ?? '',
      accessTier:
        ((data.metadata.accessTier ?? data.metadata.access_tier) as 'public' | 'private') ??
        'public',
    });

    // Create the upload session using the session manager
    const session = await sessionManager.create({
      apiKeyId: data.apiKeyId,
      fileSize: data.fileSize,
      filePath: data.filePath,
      metadata: data.metadata,
      videoAssetId: videoAsset.id,
      // The upload URL is handed to a browser, so it must be the public
      // origin. Deriving it from HOST/PORT hardcodes http:// and the
      // internal port, which breaks behind TLS or a reverse proxy.
      uploadBaseUrl: env.PUBLIC_URL.replace(/\/$/, ''),
    });

    return {
      id: session.id,
      videoAssetId: session.videoAssetId,
    };
  },

  updateUploadProgress: async (uploadId, uploadedBytes) => {
    await sessionManager.updateProgress(uploadId, uploadedBytes);
  },

  completeUpload: async (uploadId, filePath, sha256) => {
    await sessionManager.complete(uploadId, filePath, sha256);
  },

  cancelUpload: async (uploadId) => {
    // only reached from a tus DELETE, whose file store removes the files
    await sessionManager.cancel(uploadId, undefined, { removeFiles: false });
  },

  enqueueTranscoding: async (data) => {
    // Create a processing job record in the database
    await createProcessingJob({
      videoAssetId: data.videoAssetId,
      uploadSessionId: data.uploadSessionId,
    });

    // Enqueue the BullMQ transcoding job — use videoAssetId as jobId
    // so duplicate enqueue attempts (e.g. from retried hooks) are ignored
    await transcodeQueue.add(
      'transcode',
      {
        videoAssetId: data.videoAssetId,
        uploadSessionId: data.uploadSessionId,
        filePath: data.filePath,
      },
      {
        jobId: `transcode-${data.videoAssetId}`,
      },
    );
  },

  markAssetFailed: async (videoAssetId) => {
    await updateVideoAsset(videoAssetId, { status: 'failed' });
  },

  discardAsset: async (videoAssetId) => {
    // the caller's ownership was already checked against the upload metadata
    await deleteAsset(videoAssetId);
  },

  dispatchWebhook: async (event, data, owner) => {
    await webhookDispatcher.dispatch(event, data, owner);
  },
};

setMetricSources({
  queueDepth: async () => {
    const counts = await Promise.all(
      [transcodeQueue, uploadSegmentsQueue, finalizeQueue].map((q) =>
        q.getJobCounts('waiting', 'active', 'delayed'),
      ),
    );
    return counts.reduce((n, c) => n + (c.waiting ?? 0) + (c.active ?? 0) + (c.delayed ?? 0), 0);
  },
  cacheCounts: () => {
    const { hits, misses } = getCacheStats();
    return { hits, misses };
  },
});

const tusServer = createTusServer(tusServerDeps);

// Mount TUS server handler — single middleware to avoid double-firing hooks.
//
// TUS and the REST upload routes share the `/api/v1/uploads` path, so we
// dispatch by request shape: genuine TUS protocol traffic (any request
// carrying `Tus-Resumable`, plus TUS's HEAD/PATCH/OPTIONS verbs) goes to
// the TUS server; everything else (`GET /uploads/:id` status and
// `DELETE /uploads/:id` cancel) falls through to the REST router mounted
// below. Uploads themselves are only ever created through tus. Without this,
// TUS would shadow the REST upload endpoints entirely.
app.use('/api/v1/uploads', (req, res, next) => {
  if (isTusRequest(req)) {
    tusServer.handle(req, res);
  } else {
    next();
  }
});

// ──────────────────────────────────────────
// API Router
// ──────────────────────────────────────────

/**
 * Map a stored video asset row to the snake_case-agnostic record shape the
 * REST asset routes expect. Single place so the field list does not drift
 * across the list/get/update adapters.
 */
function toAssetRecord(asset: VideoAsset) {
  return {
    id: asset.id,
    title: asset.title,
    description: asset.description,
    manifestObjectId: asset.manifestObjectId,
    thumbnailObjectIds: asset.thumbnailObjectIds,
    durationMs: asset.durationMs ?? 0,
    resolution: asset.resolution ?? '',
    status: asset.status,
    accessTier: asset.accessTier,
    creatorAddress: asset.creatorAddress,
    segmentCount: asset.segmentCount,
    totalStorageBytes: asset.totalStorageBytes,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

const apiRouterDeps: ApiRouterDeps = {
  // ── UploadRouteDeps ──
  // Upload creation happens through the TUS protocol (see tusServer); the REST
  // surface only exposes owner-scoped status and cancellation.
  getUploadStatus: async (id, owner) => {
    return sessionManager.getStatus(id, owner);
  },

  cancelUpload: async (id, owner) => {
    return sessionManager.cancel(id, owner);
  },

  // ── AssetRouteDeps ──
  listAssets: async (params) => {
    const result = await listVideoAssets({
      status: params.status as
        'created' | 'uploading' | 'processing' | 'ready' | 'failed' | undefined,
      accessTier: params.accessTier as 'public' | 'private' | undefined,
      creatorAddress: params.creatorAddress,
      search: params.search,
      sort: params.sort,
      order: params.order,
      limit: params.limit,
      offset: (params.page - 1) * params.limit,
      cursor: params.cursor,
    });

    return {
      nextCursor: result.nextCursor,
      hasMore: result.hasMore,
      data: result.data.map(toAssetRecord),
      total: result.total,
    };
  },

  getAsset: async (id, owner) => {
    const asset = await getVideoAssetById(id, owner);
    if (!asset) return null;
    return toAssetRecord(asset);
  },

  updateAsset: async (id, data, owner) => {
    const updated = await updateVideoAsset(
      id,
      {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.accessTier !== undefined
          ? { accessTier: data.accessTier as 'public' | 'private' }
          : {}),
      },
      owner,
    );
    if (!updated) return null;

    // A tier change must take effect on the delivery path at once: drop the
    // cached tier for every object of this asset so the gateway re-resolves
    // (otherwise a just-privatized asset is served unsigned for up to 60s).
    if (data.accessTier !== undefined) {
      const objectIds = await getAssetObjectIds(id);
      for (const objectId of objectIds) invalidateObjectAccessTier(objectId);
    }

    return toAssetRecord(updated);
  },

  deleteAsset,

  // ── SiaInfoRouteDeps ──
  getAssetArtifacts: (assetId) => getArtifacts(assetId),
  inspectSiaObject: inspectObject,
  listSiaHosts: listHosts,
  getHostContracts,
  getWalletAddress,
  siaIndexer: { url: env.SIA_INDEXER_URL, network: env.SIA_NETWORK },
  getAssetRenditions: async (id, owner) => {
    const asset = await getVideoAssetById(id, owner);
    if (!asset) return null;
    return getRenditions(id);
  },
  getAssetWithSiaIds: async (id, owner) => {
    const asset = await getVideoAssetById(id, owner);
    if (!asset) return null;
    return {
      id: asset.id,
      manifestObjectId: asset.manifestObjectId,
      thumbnailObjectIds: asset.thumbnailObjectIds,
      siaObjectIds: (asset.siaObjectIds ?? []) as string[],
      status: asset.status,
    };
  },

  getProcessingJob: async (videoAssetId, owner) => {
    // Confirm the asset belongs to the caller before exposing its job, so a
    // processing record cannot be read across tenants.
    const asset = await getVideoAssetById(videoAssetId, owner);
    if (!asset) return undefined;
    return getProcessingJobByVideoAssetId(videoAssetId);
  },

  retryAsset: buildRetryAsset({
    getAsset: (id, owner) => getVideoAssetById(id, owner),
    getProcessingJob: (videoAssetId) => getProcessingJobByVideoAssetId(videoAssetId),
    getUploadSession: (id) => getUploadSessionById(id),
    markAssetProcessing: async (id) => {
      await updateVideoAsset(id, { status: 'processing' });
    },
    markJobProcessing: async (jobId) => {
      await updateProcessingJobStatus(jobId, { status: 'processing', errorMessage: null });
    },
    enqueueUploadSegments: async (data, jobId) => {
      await uploadSegmentsQueue.add('upload-segments', data, { jobId });
    },
    enqueueTranscode: async (data, jobId) => {
      await transcodeQueue.add('transcode', data, { jobId });
    },
    transcodeOutputDir: env.TRANSCODE_OUTPUT_DIR,
  }),

  // ── PlaybackRouteDeps ──
  getPlaybackAsset: async (id, owner) => {
    // Accept either an internal asset UUID or a public pb_... playback id.
    const assetId = await resolveAssetId(id);
    if (!assetId) return null;
    // Scope by owner so a caller cannot fetch (or mint a signed URL for)
    // another tenant's asset by guessing its id or playback id.
    const asset = await getVideoAssetById(assetId, owner);
    if (!asset) return null;
    return {
      id: asset.id,
      manifestObjectId: asset.manifestObjectId,
      thumbnailObjectIds: asset.thumbnailObjectIds,
      durationMs: asset.durationMs ?? 0,
      resolution: asset.resolution ?? '',
      accessTier: asset.accessTier,
      status: asset.status,
    };
  },

  // ── PlaybackIdRouteDeps ──
  createPlaybackId: async (assetId, opts, owner) => {
    const row = await createPlaybackIdForAsset(
      assetId,
      {
        policy: opts.policy as 'public' | 'signed' | undefined,
        name: opts.name,
      },
      owner,
    );
    if (!row) return null;
    return {
      id: row.id,
      playbackId: row.playbackId,
      policy: row.policy,
      name: row.name,
      createdAt: row.createdAt,
    };
  },

  listPlaybackIds: async (assetId, owner) => {
    const rows = await listPlaybackIdsByAsset(assetId, owner);
    if (rows === null) return null;
    return rows.map((r) => ({
      id: r.id,
      playbackId: r.playbackId,
      policy: r.policy,
      name: r.name,
      createdAt: r.createdAt,
    }));
  },

  deletePlaybackId: async (playbackId, owner) => {
    return deletePlaybackIdByPublicId(playbackId, owner);
  },

  // ── StatsRouteDeps ──
  getAssetStats: (owner) => getAssetStats(owner),
  getSystemStatus: createCachedSystemStatus({
    version: APP_VERSION,
    startedAt: STARTED_AT,
    indexerUrl: env.SIA_INDEXER_URL,
    network: env.SIA_NETWORK,
    pingDatabase: async () => {
      await db.execute(sql`select 1`);
    },
    pingRedis: async () => {
      // the bullmq client interface has no ping; any read is a real round trip
      const client = await transcodeQueue.client;
      await client.get('sluby:health');
    },
    getAccount: getAccountInfo,
    listHosts,
    getLatestReconciliation: async () => {
      const run = await getLatestReconciliationRun();
      if (!run) return null;
      return {
        status: run.status,
        finishedAt: run.finishedAt.toISOString(),
        inSyncCount: run.inSyncCount,
        orphanCount: run.orphanCount,
        missingCount: run.missingCount,
      };
    },
    getCacheStats: () => {
      const c = getCacheStats();
      return {
        hits: c.hits,
        misses: c.misses,
        objectBytes: c.object.size,
        objectMaxBytes: c.object.maxSize,
        objectItems: c.object.items,
        manifestItems: c.manifest.items,
      };
    },
  }),

  // ── ReconciliationRouteDeps ──
  getLatestRun: async () => {
    const run = await getLatestReconciliationRun();
    if (!run) return null;
    return {
      id: run.id,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      status: run.status,
      dbObjectCount: run.dbObjectCount,
      indexerObjectCount: run.indexerObjectCount,
      inSyncCount: run.inSyncCount,
      orphanCount: run.orphanCount,
      missingCount: run.missingCount,
      orphanedIds: run.orphanedIds,
      missingIds: run.missingIds,
      errorMessage: run.errorMessage,
      createdAt: run.createdAt,
    };
  },

  filterReconciliationIdsOwnedBy: filterObjectIdsOwnedBy,

  triggerRun: () => triggerReconciliation(),

  generateSignedUrl: async (manifestObjectId, expiresIn) => {
    // A real capability URL: HMAC over (objectId, expiry) that the delivery
    // gateway verifies before serving a private object's bytes.
    const expiresAtSec = Math.floor(Date.now() / 1000) + expiresIn;
    const query = buildSignedObjectQuery(manifestObjectId, expiresAtSec, env.SESSION_SECRET);
    const base = env.PUBLIC_URL.replace(/\/$/, '');
    const signedUrl = `${base}/v1/objects/${encodeURIComponent(manifestObjectId)}?type=manifest&${query}`;
    return { signedUrl, expiresAt: new Date(expiresAtSec * 1000).toISOString() };
  },

  createShareUrls: (assetId, masterObjectId, expiresIn) =>
    createAssetShareUrls(assetId, masterObjectId, expiresIn),

  resolveObjectTier: (objectId) => getObjectAccessTier(objectId),

  // ── WebhookRouteDeps ──
  createWebhook: async (data) => {
    const endpoint = await createWebhookEndpoint({
      creatorAddress: data.creatorAddress,
      apiKeyId: data.apiKeyId,
      url: data.url,
      events: data.events,
      secret: data.secret,
    });
    return { id: endpoint.id };
  },

  listWebhooks: async (creatorAddress) => {
    const endpoints = await listWebhookEndpointsByOwner(creatorAddress);
    return endpoints.map((ep) => ({
      id: ep.id,
      url: ep.url,
      events: ep.events,
      isActive: ep.isActive,
      createdAt: ep.createdAt,
    }));
  },

  deleteWebhook: async (id, creatorAddress) => {
    const deleted = await deleteWebhookEndpoint(id, creatorAddress);
    return Boolean(deleted);
  },

  // ── ApiKeyMiddlewareDeps ──
  findActiveSession: findActiveStudioSession,
  createSession: createStudioSession,
  listActiveSessions: listActiveStudioSessions,
  revokeSession: revokeStudioSession,
  revokeAllSessions: revokeAllStudioSessions,
  pruneSessions: pruneStudioSessions,

  findApiKeyByHash: async (hash) => {
    const apiKey = await getApiKeyByHash(hash);
    if (!apiKey) return null;
    return {
      id: apiKey.id,
      name: apiKey.name,
      scopes: apiKey.scopes,
      rateLimit: apiKey.rateLimit,
      creatorAddress: apiKey.creatorAddress,
      isActive: apiKey.isActive,
      expiresAt: apiKey.expiresAt,
    };
  },

  // ── ApiRouterDeps (key management) ──
  createApiKey: async (data) => {
    // Insert directly since we already have the hash from the router's generateApiKey()
    const [result] = await db
      .insert(apiKeysTable)
      .values({
        keyHash: data.keyHash,
        name: data.name,
        scopes: data.scopes,
        rateLimit: data.rateLimit,
        creatorAddress: data.creatorAddress,
      })
      .returning({ id: apiKeysTable.id });
    return { id: result.id };
  },

  listApiKeys: async (creatorAddress) => {
    const keys = await dbListApiKeys({ creatorAddress });
    return keys.map((k) => ({
      id: k.id,
      name: k.name,
      scopes: k.scopes,
      rateLimit: k.rateLimit,
      isActive: k.isActive,
      createdAt: k.createdAt,
      expiresAt: k.expiresAt,
    }));
  },

  rotateApiKey: async (id, owner, { keyHash }, retireAt) => {
    const result = await dbRotateApiKey(id, owner, keyHash, retireAt);
    if (result.status !== 'rotated') return result;
    const k = result.replacement;
    return {
      status: 'rotated',
      replacement: {
        id: k.id,
        name: k.name,
        scopes: k.scopes,
        rateLimit: k.rateLimit,
        isActive: k.isActive,
        createdAt: k.createdAt,
        expiresAt: k.expiresAt,
      },
      retiredAt: result.retiredAt,
    };
  },

  deleteApiKey: async (id, owner) => {
    const deleted = await dbDeleteApiKey(id, owner);
    return Boolean(deleted);
  },
};

const apiRouter = createApiRouter(apiRouterDeps);

// Mount API router at /api/v1 (but below the TUS handler which takes priority)
app.use('/api/v1', apiRouter);

// ──────────────────────────────────────────
// Delivery Routes
// ──────────────────────────────────────────

// Set db on app for the delivery aggregator's stream endpoint
app.set('db', db);

// The delivery router defines routes with /v1/ prefix in the path
// so we mount it at root
app.use('/', deliveryRouter);

// ──────────────────────────────────────────
// Metrics (Prometheus format)
// ──────────────────────────────────────────

app.get('/metrics', createPrometheusHandler(logger));

// ── 404 Handler ──

app.use(notFoundHandler);

// ── Error Handling Middleware ──

app.use(createErrorHandler(logger));

// ──────────────────────────────────────────
// Bootstrap API Key (if configured)
// ──────────────────────────────────────────

async function bootstrapApiKey(): Promise<void> {
  if (!env.BOOTSTRAP_API_KEY) return;
  const outcome = await seedBootstrapApiKey(db, env.BOOTSTRAP_API_KEY);
  if (outcome === 'created') {
    logger.info({ platformAddress: BOOTSTRAP_CREATOR_ADDRESS }, 'Bootstrap API key seeded');
  }
}

// ──────────────────────────────────────────
// Server Startup
// ──────────────────────────────────────────

// Seed bootstrap key before accepting requests
bootstrapApiKey().catch((err) => {
  logger.warn({ err }, 'Failed to seed bootstrap API key (non-fatal)');
});

// Make an open Studio explicit rather than a silent default.
if (!env.AUTH_DISABLED && env.GITHUB_ALLOWED_USERS.trim() === '') {
  logger.warn(
    'GITHUB_ALLOWED_USERS is empty: Studio sign-in is open to any GitHub account. ' +
      'Set GITHUB_ALLOWED_USERS to restrict it.',
  );
}

// Register the periodic reconciliation sweep (non-fatal if Redis is down).
scheduleReconciliation().catch((err) => {
  logger.warn({ err }, 'Failed to schedule reconciliation sweep (non-fatal)');
});

// Register the periodic deletion GC sweep (non-fatal if Redis is down).
scheduleDeletionGc().catch((err) => {
  logger.warn({ err }, 'Failed to schedule deletion GC sweep (non-fatal)');
});

// Sweep incomplete tus uploads past their expiry, now and then every hour.
// A timer in this process rather than a queue job, because the files live on
// this process's UPLOAD_DIR.
void sweepExpiredUploads(tusServer, logger);
const uploadSweepTimer = setInterval(
  () => void sweepExpiredUploads(tusServer, logger),
  UPLOAD_SWEEP_INTERVAL_MS,
);
uploadSweepTimer.unref();

const server = app.listen(env.PORT, env.HOST, () => {
  logger.info({ host: env.HOST, port: env.PORT }, 'Sluby backend is running');
  // connecting to the indexer takes a while on a cold start; do it now rather
  // than inside the first upload or status check. a failure here is only
  // logged: getClient retries on the next call.
  if (env.SIA_APP_KEY) {
    getClient().catch((err) =>
      logger.warn({ err }, 'Could not connect to the Sia indexer at startup'),
    );
  } else {
    logger.warn('SIA_APP_KEY is not set: uploads need an indexer connection (see connect-indexer)');
  }
});

// ──────────────────────────────────────────
// Graceful Shutdown
// ──────────────────────────────────────────

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Received shutdown signal, starting graceful shutdown');

  clearInterval(uploadSweepTimer);

  // Stop accepting new connections
  server.close(() => {
    logger.info('HTTP server closed');
  });

  try {
    // Close workers first (stop processing new jobs)
    logger.info('Closing queue workers...');
    await Promise.all([closeWorkers(), closeReconcileWorker(), closeDeletionWorker()]);

    // Close queue connections
    logger.info('Closing queue connections...');
    await closeQueues();

    // Close database connection pool
    logger.info('Closing database connection...');
    await closeDatabase();

    logger.info('Graceful shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Error during graceful shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Catch unhandled rejections and exceptions
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (error) => {
  logger.fatal({ error }, 'Uncaught exception, shutting down');
  gracefulShutdown('uncaughtException');
});

export { app };
