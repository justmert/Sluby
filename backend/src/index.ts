import 'express-async-errors';
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import pino from 'pino';
import path from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { env } from './config/env.js';
import { db } from './config/database.js';
import { closeDatabase } from './config/database.js';
import { closeQueues, transcodeQueue, uploadSegmentsQueue } from './queue/bull-config.js';
import { closeWorkers } from './queue/processors.js';

// ── Real module imports ──

import { createApiRouter, type ApiRouterDeps } from './api/router.js';
import { createTusServer, type TusServerDeps } from './upload/tus-server.js';
import { deliveryRouter } from './delivery/aggregator.js';
import { registry, getMetrics } from './metrics/collector.js';

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
  deleteVideoAsset,
} from './db/queries/assets.js';

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
} from './db/queries/api-keys.js';

import { apiKeys as apiKeysTable } from './db/schema.js';

import {
  createWebhookEndpoint,
  listWebhookEndpointsByApiKeyId,
  deleteWebhookEndpoint,
  findEndpointsForEvent,
  createWebhookDelivery,
} from './db/queries/webhooks.js';

// Other imports
import { SessionManager } from './upload/session-manager.js';
import { WebhookDispatcher } from './webhooks/dispatcher.js';

// ──────────────────────────────────────────
// Logger
// ──────────────────────────────────────────

export const logger = pino({
  name: 'sluby',
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

// ──────────────────────────────────────────
// Ensure required directories exist
// ──────────────────────────────────────────

for (const dir of [env.UPLOAD_DIR, env.TRANSCODE_OUTPUT_DIR, env.CACHE_DIR]) {
  mkdirSync(dir, { recursive: true });
}

// ──────────────────────────────────────────
// Webhook Dispatcher
// ──────────────────────────────────────────

const webhookDispatcher = new WebhookDispatcher({
  getActiveWebhooksForEvent: async (event: string) => {
    const endpoints = await findEndpointsForEvent(event);
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

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version ?? '0.1.0',
  });
});

// ──────────────────────────────────────────
// TUS Upload Handler
// ──────────────────────────────────────────

const tusServerDeps: TusServerDeps = {
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
      accessTier: ((data.metadata.accessTier ?? data.metadata.access_tier) as 'public' | 'private') ?? 'public',
    });

    // Create the upload session using the session manager
    const session = await sessionManager.create({
      apiKeyId: data.apiKeyId,
      fileSize: data.fileSize,
      metadata: data.metadata,
      videoAssetId: videoAsset.id,
      uploadBaseUrl: `http://${env.HOST === '0.0.0.0' ? 'localhost' : env.HOST}:${env.PORT}`,
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
    await sessionManager.cancel(uploadId);
  },

  enqueueTranscoding: async (data) => {
    // Create a processing job record in the database
    await createProcessingJob({
      videoAssetId: data.videoAssetId,
      uploadSessionId: data.uploadSessionId,
    });

    // Enqueue the BullMQ transcoding job — use videoAssetId as jobId
    // so duplicate enqueue attempts (e.g. from retried hooks) are ignored
    await transcodeQueue.add('transcode', {
      videoAssetId: data.videoAssetId,
      uploadSessionId: data.uploadSessionId,
      filePath: data.filePath,
    }, {
      jobId: `transcode-${data.videoAssetId}`,
    });
  },

  dispatchWebhook: async (event, data) => {
    await webhookDispatcher.dispatch(event, data);
  },
};

const tusServer = createTusServer(tusServerDeps);

// Mount TUS server handler — single middleware to avoid double-firing hooks
app.use('/api/v1/uploads', (req, res) => {
  tusServer.handle(req, res);
});

// ──────────────────────────────────────────
// API Router
// ──────────────────────────────────────────

const apiRouterDeps: ApiRouterDeps = {
  // ── UploadRouteDeps ──
  createUploadSession: async (params) => {
    // Create a video asset in DB
    const videoAsset = await createVideoAsset({
      title: params.title,
      description: params.description,
      creatorAddress: params.creatorAddress,
      accessTier: params.accessTier as 'public' | 'private',
    });

    // Create an upload session
    const session = await sessionManager.create({
      apiKeyId: params.apiKeyId,
      fileSize: 0,
      metadata: {
        title: params.title,
        description: params.description,
        accessTier: params.accessTier,
      },
      videoAssetId: videoAsset.id,
      uploadBaseUrl: `http://${env.HOST === '0.0.0.0' ? 'localhost' : env.HOST}:${env.PORT}`,
    });

    return {
      videoAssetId: videoAsset.id,
      uploadUrl: session.uploadUrl,
    };
  },

  getUploadStatus: async (id) => {
    return sessionManager.getStatus(id);
  },

  cancelUpload: async (id) => {
    await sessionManager.cancel(id);
  },

  // ── AssetRouteDeps ──
  listAssets: async (params) => {
    const result = await listVideoAssets({
      status: params.status as 'created' | 'uploading' | 'processing' | 'ready' | 'failed' | undefined,
      accessTier: params.accessTier as 'public' | 'private' | undefined,
      creatorAddress: params.creatorAddress,
      limit: params.limit,
      offset: (params.page - 1) * params.limit,
    });

    return {
      data: result.data.map((asset) => ({
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
      })),
      total: result.total,
    };
  },

  getAsset: async (id) => {
    const asset = await getVideoAssetById(id);
    if (!asset) return null;
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
  },

  updateAsset: async (id, data) => {
    const updated = await updateVideoAsset(id, {
      ...(data.title !== undefined ? { title: data.title } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.accessTier !== undefined
        ? { accessTier: data.accessTier as 'public' | 'private' }
        : {}),
    });
    if (!updated) return null;
    return {
      id: updated.id,
      title: updated.title,
      description: updated.description,
      manifestObjectId: updated.manifestObjectId,
      thumbnailObjectIds: updated.thumbnailObjectIds,
      durationMs: updated.durationMs ?? 0,
      resolution: updated.resolution ?? '',
      status: updated.status,
      accessTier: updated.accessTier,
      creatorAddress: updated.creatorAddress,
      segmentCount: updated.segmentCount,
      totalStorageBytes: updated.totalStorageBytes,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  },

  deleteAsset: async (id) => {
    await deleteVideoAsset(id);
  },

  // ── SiaInfoRouteDeps ──
  getAssetWithSiaIds: async (id) => {
    const asset = await getVideoAssetById(id);
    if (!asset) return null;
    return {
      id: asset.id,
      manifestObjectId: asset.manifestObjectId,
      thumbnailObjectIds: asset.thumbnailObjectIds,
      siaObjectIds: (asset.siaObjectIds ?? []) as string[],
      totalStorageBytes: asset.totalStorageBytes,
      status: asset.status,
    };
  },

  getProcessingJob: async (videoAssetId) => {
    return getProcessingJobByVideoAssetId(videoAssetId);
  },

  retryAsset: async (id) => {
    const asset = await getVideoAssetById(id);
    if (!asset) throw Object.assign(new Error('Video asset not found'), { statusCode: 404 });
    if (asset.status !== 'failed') throw Object.assign(new Error('Asset is not in failed state'), { statusCode: 400 });

    const processingJob = await getProcessingJobByVideoAssetId(id);
    const uploadSessionId = processingJob?.uploadSessionId ?? '';

    const outputDir = path.join(env.TRANSCODE_OUTPUT_DIR, id);
    const hasTranscodedOutput = existsSync(path.join(outputDir, 'master.m3u8'));

    if (hasTranscodedOutput) {
      // Transcoding done — retry from upload-segments stage
      await updateVideoAsset(id, { status: 'processing' });
      if (processingJob) {
        await updateProcessingJobStatus(processingJob.id, { status: 'processing', errorMessage: null });
      }
      await uploadSegmentsQueue.add('upload-segments', {
        videoAssetId: id,
        uploadSessionId,
        outputDir,
        accessTier: asset.accessTier,
      }, { jobId: `retry-upload-${id}-${Date.now()}` });
      return { stage: 'upload-segments' };
    }

    // No transcoded output — need to find source file and re-transcode
    const session = uploadSessionId ? await getUploadSessionById(uploadSessionId) : null;
    if (!session?.filePath || !existsSync(session.filePath)) {
      throw Object.assign(new Error('Source file not found — please re-upload the video'), { statusCode: 410 });
    }

    await updateVideoAsset(id, { status: 'processing' });
    if (processingJob) {
      await updateProcessingJobStatus(processingJob.id, { status: 'processing', errorMessage: null });
    }
    await transcodeQueue.add('transcode', {
      videoAssetId: id,
      uploadSessionId,
      filePath: session.filePath,
    }, { jobId: `retry-transcode-${id}-${Date.now()}` });
    return { stage: 'transcode' };
  },

  // ── PlaybackRouteDeps ──
  getPlaybackAsset: async (id) => {
    const asset = await getVideoAssetById(id);
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

  generateSignedUrl: async (manifestObjectId, expiresIn) => {
    const { shareObject } = await import('./storage/sia-client.js');
    const expiresAt = new Date(Date.now() + expiresIn * 1000);
    const signedUrl = await shareObject(manifestObjectId, expiresAt);
    return { signedUrl, expiresAt: expiresAt.toISOString() };
  },

  // ── WebhookRouteDeps ──
  createWebhook: async (data) => {
    const endpoint = await createWebhookEndpoint({
      apiKeyId: data.apiKeyId,
      url: data.url,
      events: data.events,
      secret: data.secret,
    });
    return { id: endpoint.id };
  },

  listWebhooks: async (apiKeyId) => {
    const endpoints = await listWebhookEndpointsByApiKeyId(apiKeyId);
    return endpoints.map((ep) => ({
      id: ep.id,
      url: ep.url,
      events: ep.events,
      isActive: ep.isActive,
      createdAt: ep.createdAt,
    }));
  },

  deleteWebhook: async (id) => {
    await deleteWebhookEndpoint(id);
  },

  // ── ApiKeyMiddlewareDeps ──
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
    const [result] = await db.insert(apiKeysTable).values({
      keyHash: data.keyHash,
      name: data.name,
      scopes: data.scopes,
      rateLimit: data.rateLimit,
      creatorAddress: data.creatorAddress,
    }).returning({ id: apiKeysTable.id });
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
    }));
  },

  deleteApiKey: async (id) => {
    await dbDeleteApiKey(id);
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

app.get('/metrics', async (_req: Request, res: Response) => {
  try {
    const metricsText = await getMetrics();
    res.set('Content-Type', registry.contentType);
    res.end(metricsText);
  } catch (err) {
    logger.error({ err }, 'Failed to collect metrics');
    res.status(500).json({ error: 'Failed to collect metrics' });
  }
});

// ── 404 Handler ──

app.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${_req.method} ${_req.path} not found`,
  });
});

// ── Error Handling Middleware ──

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  const statusCode = (err as unknown as { statusCode?: number }).statusCode ?? 500;
  const isProduction = process.env.NODE_ENV === 'production';

  logger.error(
    {
      err,
      method: req.method,
      url: req.url,
      statusCode,
    },
    'Unhandled error',
  );

  res.status(statusCode).json({
    error: statusCode >= 500 ? 'Internal Server Error' : err.message,
    ...(isProduction ? {} : { message: err.message, stack: err.stack }),
  });
});

// ──────────────────────────────────────────
// Bootstrap API Key (if configured)
// ──────────────────────────────────────────

async function bootstrapApiKey(): Promise<void> {
  if (!env.BOOTSTRAP_API_KEY) return;

  const { createHash } = await import('node:crypto');
  const { eq } = await import('drizzle-orm');
  const { apiKeys } = await import('./db/schema.js');

  const keyHash = createHash('sha256').update(env.BOOTSTRAP_API_KEY).digest('hex');

  let platformAddress = 'platform';

  // Check if this specific bootstrap key already exists
  const existing = await db.query.apiKeys.findFirst({
    where: eq(apiKeys.keyHash, keyHash),
  });

  if (existing) {
    return;
  }

  await db.insert(apiKeys).values({
    keyHash,
    name: 'bootstrap',
    scopes: ['upload', 'read', 'manage'],
    rateLimit: 1000,
    creatorAddress: platformAddress,
    isActive: true,
  });

  logger.info({ platformAddress }, 'Bootstrap API key seeded');
}

// ──────────────────────────────────────────
// Server Startup
// ──────────────────────────────────────────

// Seed bootstrap key before accepting requests
bootstrapApiKey().catch((err) => {
  logger.warn({ err }, 'Failed to seed bootstrap API key (non-fatal)');
});

const server = app.listen(env.PORT, env.HOST, () => {
  logger.info(
    { host: env.HOST, port: env.PORT },
    'Sluby backend is running',
  );
});

// ──────────────────────────────────────────
// Graceful Shutdown
// ──────────────────────────────────────────

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Received shutdown signal, starting graceful shutdown');

  // Stop accepting new connections
  server.close(() => {
    logger.info('HTTP server closed');
  });

  try {
    // Close workers first (stop processing new jobs)
    logger.info('Closing queue workers...');
    await closeWorkers();

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
