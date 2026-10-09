import express, { type Request, type Response, type NextFunction, type Express } from 'express';
import type { Logger } from 'pino';
import type { Server as TusServer } from '@tus/server';
import { sql } from 'drizzle-orm';
import { env } from './config/env.js';
import { db } from './config/database.js';

import { createApiRouter, type ApiRouterDeps } from './api/router.js';
import { mountRouter } from './api/list-routes.js';
import { createApiCors, createCrossOriginWriteGuard } from './api/cors.js';
import { createIpRateLimiter } from './api/rate-limiter.js';
import { createTusServer, type TusServerDeps } from './upload/tus-server.js';
import { isTusRequest } from './upload/tus-dispatch.js';
import { SessionManager } from './upload/session-manager.js';
import { buildSignedObjectQuery } from './delivery/signed-url.js';
import { createAssetShareUrls } from './delivery/share-urls.js';
import { deliveryRouter } from './delivery/aggregator.js';
import { invalidateAssetAccess } from './delivery/access-control.js';
import { setMetricSources } from './metrics/collector.js';
import {
  createHealthHandler,
  createPrometheusHandler,
  requireMetricsToken,
} from './api/service-routes.js';
import { createErrorHandler, notFoundHandler } from './api/middleware/error-handler.js';
import { loggableUrl } from './api/log-url.js';
import { buildDeleteAsset } from './deletion/service.js';
import { buildRetryAsset } from './queue/retry.js';
import type { TranscodeJobData, UploadSegmentsJobData } from './queue/bull-config.js';

import {
  createUploadSession as dbCreateUploadSession,
  getCompletedUploadSessionForAsset,
  getUploadSessionById,
  listExpiredUploadingSessions,
  updateUploadSession,
} from './db/queries/uploads.js';
import { removeSourceUpload } from './upload/source-files.js';
import {
  createVideoAsset,
  getVideoAssetById,
  listVideoAssets,
  updateVideoAsset,
  updateAssetMetadata,
  softDeleteVideoAsset,
  markAssetUploading,
  claimFailedAssetForRetry,
  releaseRetryClaim,
  raiseSigningGeneration,
} from './db/queries/assets.js';
import {
  createProcessingJob,
  getProcessingJobByVideoAssetId,
  restartProcessingJob,
} from './db/queries/jobs.js';
import { findCompletedOutput } from './queue/output-dirs.js';
import {
  getApiKeyByHash,
  createApiKeyWithinCap,
  listApiKeys as dbListApiKeys,
  deleteApiKey as dbDeleteApiKey,
  rotateApiKey as dbRotateApiKey,
  renameApiKey as dbRenameApiKey,
  touchApiKeyLastUsed,
} from './db/queries/api-keys.js';
import { createKeyUseRecorder } from './api/auth/key-usage.js';
import type { ApiKey, VideoAsset } from './db/schema.js';
import type { WebhookEndpointWithHealth } from './db/queries/webhooks.js';
import {
  createWebhookEndpoint,
  createWebhookDelivery,
  getWebhookEndpointForOwner,
  getWebhookEndpointWithHealth,
  updateWebhookEndpoint,
  setWebhookSecret,
  getWebhookDelivery,
  listWebhookDeliveries,
  listWebhookEndpointsByOwner,
  deleteWebhookEndpoint,
} from './db/queries/webhooks.js';
import { EgressError, vetUrl } from './webhooks/egress.js';
import { webhookEgressPolicy } from './webhooks/policy.js';
import {
  attemptDelivery,
  eventBody,
  newDeliveryId,
  type WebhookJobData,
} from './webhooks/delivery.js';
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
import {
  ensureIdentityAccount,
  findLegacyClaim,
  getAccount,
  isAllowlistEntryPinned,
  signInIdentity,
} from './db/queries/accounts.js';
import type { CallerDeps } from './api/auth/caller.js';
import { LOCAL_DEV_SUBJECT, LOCAL_PROVIDER } from './api/auth/providers/index.js';
import { getLatestReconciliationRun, filterObjectIdsOwnedBy } from './db/queries/reconciliation.js';
import { getAssetStats } from './db/queries/stats.js';
import { getArtifacts, getRenditions } from './db/queries/storage-records.js';
import { createCachedSystemStatus } from './system/status.js';
import {
  getAccountInfo,
  listHosts,
  inspectObject,
  getHostContracts,
  getWalletAddress,
} from './storage/sia-client.js';
import { getCacheStats } from './storage/blob-manager.js';

/** The slice of a BullMQ queue the API wiring uses. */
export interface AppQueue<T> {
  add(name: string, data: T, opts?: { jobId?: string }): Promise<unknown>;
  getJobCounts(...types: string[]): Promise<Record<string, number>>;
}

/**
 * The runtime pieces the API wiring needs that start connections or workers
 * when created. index.ts passes the real BullMQ queues, webhook dispatcher and
 * reconcile trigger; tests pass in-memory ones, so the routes and adapters
 * run against a real database without Redis or workers.
 */
export interface AppContext {
  logger: Logger;
  version: string;
  startedAt: Date;
  queues: {
    transcode: AppQueue<TranscodeJobData>;
    uploadSegments: AppQueue<UploadSegmentsJobData>;
    finalize: AppQueue<unknown>;
    deletion: AppQueue<{ kind: 'delete'; videoAssetId: string }>;
  };
  /** One real round trip to Redis, for the status probe. */
  pingRedis: () => Promise<void>;
  webhookDispatcher: {
    dispatch: (event: string, data: Record<string, unknown>, owner: string) => Promise<void>;
    /** Queue one delivery as it is (a resend). */
    enqueue: (job: WebhookJobData) => Promise<void>;
  };
  triggerReconciliation: () => Promise<{ enqueued: boolean }>;
}

export function buildSessionManager(): SessionManager {
  return new SessionManager({
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
}

/**
 * Soft-delete the asset (it vanishes from the API immediately), capture its
 * Sia object ids, and enqueue the async unpin-and-remove job. Shared by the
 * assets route and by tus when an uploader cancels.
 */
export function buildAssetDeleter(ctx: AppContext) {
  return buildDeleteAsset({
    softDelete: async (id, owner) => {
      const row = await softDeleteVideoAsset(id, owner);
      // the gateway stops serving its objects now, not when the cached state
      // of the asset runs out
      if (row) invalidateAssetAccess(id);
      return row;
    },
    enqueue: async (videoAssetId) => {
      await ctx.queues.deletion.add(
        'delete',
        { kind: 'delete', videoAssetId },
        { jobId: `delete-${videoAssetId}` },
      );
    },
  });
}

const LOCAL_DEV = {
  provider: LOCAL_PROVIDER,
  subject: LOCAL_DEV_SUBJECT,
  username: 'dev',
  displayName: 'Local developer',
};

/** The AUTH_DISABLED account, created on first use and then remembered. */
export function buildLocalDevAccount() {
  let account: Promise<{ userId: string; username: string; displayName: string }> | undefined;
  return () => {
    account ??= ensureIdentityAccount(LOCAL_DEV).then(
      ({ userId }) => ({
        userId,
        username: LOCAL_DEV.username,
        displayName: LOCAL_DEV.displayName,
      }),
      (err: unknown) => {
        account = undefined;
        throw err;
      },
    );
    return account;
  };
}

/** How the REST api and tus resolve a request's caller, from the database. */
export function buildCallerDeps(
  localDevAccount: ReturnType<typeof buildLocalDevAccount>,
  logger: Logger,
): CallerDeps {
  return {
    findActiveSession: findActiveStudioSession,
    getAccount,
    findLegacyClaim,
    isAllowlistEntryPinned,
    localDevAccount,
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
        lastUsedAt: apiKey.lastUsedAt,
      };
    },
    recordKeyUse: createKeyUseRecorder({
      write: touchApiKeyLastUsed,
      onError: (err, id) => logger.warn({ err, keyId: id }, 'Could not record key use'),
    }),
  };
}

export function buildTusServerDeps(
  ctx: AppContext,
  sessionManager: SessionManager,
  deleteAsset: (id: string, owner?: string) => Promise<boolean>,
  callers: CallerDeps,
): TusServerDeps {
  return {
    callers,

    createUploadSession: async (data) => {
      // the tus hook validated these fields already
      const videoAsset = await createVideoAsset({
        title: data.title,
        description: data.description,
        creatorAddress: data.metadata.creatorAddress ?? '',
        accessTier: data.accessTier,
      });

      let session: { id: string; videoAssetId?: string };
      try {
        session = await sessionManager.create({
          id: data.id,
          apiKeyId: data.apiKeyId,
          fileSize: data.fileSize,
          filePath: data.filePath,
          metadata: data.metadata,
          videoAssetId: videoAsset.id,
          // the same public origin the tus Location is built from
          uploadBaseUrl: env.PUBLIC_URL.replace(/\/$/, ''),
        });
      } catch (err) {
        // without its session the asset could never receive bytes
        await deleteAsset(videoAsset.id);
        throw err;
      }

      return {
        id: session.id,
        videoAssetId: session.videoAssetId,
      };
    },

    updateUploadProgress: async (uploadId, uploadedBytes) => {
      await sessionManager.updateProgress(uploadId, uploadedBytes);
    },

    markUploading: async (uploadId) => {
      await markAssetUploading(uploadId);
    },

    completeUpload: async (uploadId, filePath, sha256) => {
      await sessionManager.complete(uploadId, filePath, sha256);
    },

    cancelUpload: async (uploadId) => {
      // only reached from a tus DELETE, whose file store removes the files
      await sessionManager.cancel(uploadId, undefined, { removeFiles: false });
    },

    abandonUpload: async (sessionId, videoAssetId) => {
      await updateUploadSession(sessionId, { status: 'failed' });
      if (videoAssetId) await deleteAsset(videoAssetId);
    },

    enqueueTranscoding: async (data) => {
      // Create a processing job record in the database
      await createProcessingJob({
        videoAssetId: data.videoAssetId,
        uploadSessionId: data.uploadSessionId,
      });

      // Enqueue the BullMQ transcoding job; the videoAssetId job id makes a
      // duplicate enqueue (e.g. from a retried hook) a no-op
      await ctx.queues.transcode.add(
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

    // best effort, like the pipeline's events: a webhook that cannot be queued
    // must not fail the upload
    dispatchWebhook: async (event, data, owner) => {
      try {
        await ctx.webhookDispatcher.dispatch(event, data, owner);
      } catch (err) {
        ctx.logger.warn({ event, err }, 'Webhook event not sent');
      }
    },
  };
}

/**
 * Close uploads that expired while still in progress: the session becomes
 * `failed`, its partial file goes, and an asset that never got past the
 * upload is discarded so it does not sit in the library as `created`. The
 * tus expiry sweep removes the same files; this one fixes the rows. Returns
 * how many sessions it closed.
 */
export function buildUploadExpiry(
  ctx: AppContext,
  deleteAsset: (id: string, owner?: string) => Promise<boolean>,
) {
  return async (now: Date = new Date()): Promise<number> => {
    const expired = await listExpiredUploadingSessions(now);
    for (const s of expired) {
      await removeSourceUpload(s.filePath, ctx.logger, { sessionId: s.id });
      await updateUploadSession(s.id, { status: 'failed' });
      const neverUploaded = s.assetStatus === 'created' || s.assetStatus === 'uploading';
      if (s.videoAssetId && neverUploaded && !s.assetDeleted) {
        await deleteAsset(s.videoAssetId);
      }
    }
    if (expired.length > 0) {
      ctx.logger.info({ closed: expired.length }, 'Closed expired uploads');
    }
    return expired.length;
  };
}

/**
 * Map a stored video asset row to the record shape the REST asset routes
 * expect. Single place so the field list does not drift across the
 * list/get/update adapters.
 */
function toAssetRecord(asset: VideoAsset) {
  return {
    id: asset.id,
    title: asset.title,
    description: asset.description,
    manifestObjectId: asset.manifestObjectId,
    thumbnailObjectIds: asset.thumbnailObjectIds,
    // the columns default to 0 and '' until processing measures them, and a
    // real video never has either value, so both mean "not known yet"
    durationMs: asset.durationMs || null,
    resolution: asset.resolution || null,
    status: asset.status,
    accessTier: asset.accessTier,
    creatorAddress: asset.creatorAddress,
    segmentCount: asset.segmentCount,
    totalStorageBytes: asset.totalStorageBytes,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

function toWebhookRecord(ep: WebhookEndpointWithHealth) {
  return {
    id: ep.id,
    url: ep.url,
    events: ep.events,
    isActive: ep.isActive,
    createdAt: ep.createdAt,
    lastDeliveryAt: ep.lastDeliveryAt,
    lastDeliveryOk: ep.lastDeliveryOk,
  };
}

function toKeyRecord(k: ApiKey) {
  return {
    id: k.id,
    name: k.name,
    scopes: k.scopes,
    rateLimit: k.rateLimit,
    isActive: k.isActive,
    createdAt: k.createdAt,
    expiresAt: k.expiresAt,
    prefix: k.prefix,
    lastUsedAt: k.lastUsedAt,
  };
}

export function buildApiDeps(
  ctx: AppContext,
  sessionManager: SessionManager,
  deleteAsset: (id: string, owner?: string) => Promise<boolean>,
  callers: CallerDeps,
  localDevAccount: ReturnType<typeof buildLocalDevAccount>,
  /** Bytes the tus store holds for upload `id`, or null when it has none. */
  receivedBytes: (id: string) => Promise<number | null> = async () => null,
): ApiRouterDeps {
  return {
    ...callers,
    localDevAccount,
    signIn: signInIdentity,
    createSession: createStudioSession,
    listActiveSessions: listActiveStudioSessions,
    revokeSession: revokeStudioSession,
    revokeAllSessions: revokeAllStudioSessions,
    pruneSessions: pruneStudioSessions,

    // Upload creation happens through the TUS protocol (see tusServer); the REST
    // surface only exposes owner-scoped status and cancellation.
    getUploadStatus: async (id, owner) => {
      const status = await sessionManager.getStatus(id, owner);
      if (!status || status.status !== 'uploading') return status;
      // the stored count comes from a throttled tus event that is dropped at
      // the end of each PATCH, so the bytes on disk are the true progress
      const received = await receivedBytes(id);
      if (received === null) return status;
      return {
        ...status,
        uploadedBytes: received,
        progressPercent: status.fileSize > 0 ? Math.round((received / status.fileSize) * 100) : 0,
      };
    },

    cancelUpload: async (id, owner) => {
      // the same outcome as a tus DELETE: no partial file and no empty asset
      const outcome = await sessionManager.cancel(id, owner);
      if (outcome.status === 'cancelled' && outcome.videoAssetId) {
        await deleteAsset(outcome.videoAssetId);
      }
      return outcome.status;
    },

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
      const updated = await updateAssetMetadata(
        id,
        {
          ...(data.title !== undefined ? { title: data.title } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
          ...(data.accessTier !== undefined ? { accessTier: data.accessTier } : {}),
        },
        owner,
      );
      if (!updated) return null;

      // A tier change must take effect on the delivery path at once: drop the
      // asset's cached state so the gateway reads the new tier and signing
      // generation (otherwise a just-privatized asset is served unsigned for
      // up to a minute by this process).
      if (data.accessTier !== undefined) invalidateAssetAccess(id);

      return toAssetRecord(updated);
    },

    deleteAsset,

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
      createProcessingJob: (videoAssetId, uploadSessionId) =>
        createProcessingJob({ videoAssetId, uploadSessionId }),
      getUploadSession: (videoAssetId) => getCompletedUploadSessionForAsset(videoAssetId),
      findCompletedOutput: (videoAssetId) =>
        findCompletedOutput(env.TRANSCODE_OUTPUT_DIR, videoAssetId),
      claimFailedAsset: (id, owner) => claimFailedAssetForRetry(id, owner),
      releaseClaim: (id) => releaseRetryClaim(id),
      restartJob: (jobId) => restartProcessingJob(jobId),
      enqueueUploadSegments: async (data, jobId) => {
        await ctx.queues.uploadSegments.add('upload-segments', data, { jobId });
      },
      enqueueTranscode: async (data, jobId) => {
        await ctx.queues.transcode.add('transcode', data, { jobId });
      },
    }),

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
        durationMs: asset.durationMs || null,
        resolution: asset.resolution || null,
        accessTier: asset.accessTier,
        status: asset.status,
        signingGeneration: asset.signingGeneration,
      };
    },

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

    getAssetStats: (owner) => getAssetStats(owner),
    getSystemStatus: createCachedSystemStatus({
      version: ctx.version,
      startedAt: ctx.startedAt,
      indexerUrl: env.SIA_INDEXER_URL,
      network: env.SIA_NETWORK,
      pingDatabase: async () => {
        await db.execute(sql`select 1`);
      },
      pingRedis: ctx.pingRedis,
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

    triggerRun: () => ctx.triggerReconciliation(),

    generateSignedUrl: async (asset, expiresIn) => {
      // A real capability URL: HMAC over (objectId, expiry, the asset's
      // signing generation) that the delivery gateway verifies before serving
      // a private object's bytes.
      const expiresAtSec = Math.floor(Date.now() / 1000) + expiresIn;
      const base = env.PUBLIC_URL.replace(/\/$/, '');
      const signedObjectUrl = (objectId: string, type: string) =>
        `${base}/v1/objects/${encodeURIComponent(objectId)}?type=${type}&${buildSignedObjectQuery(
          objectId,
          expiresAtSec,
          asset.signingGeneration,
          env.SESSION_SECRET,
        )}`;
      return {
        signedUrl: signedObjectUrl(asset.manifestObjectId, 'manifest'),
        posterUrl: asset.posterObjectId ? signedObjectUrl(asset.posterObjectId, 'poster') : null,
        expiresAt: new Date(expiresAtSec * 1000).toISOString(),
      };
    },

    revokeSignedUrls: async (assetId, owner) => {
      const generation = await raiseSigningGeneration(assetId, owner);
      if (generation === undefined) return null;
      invalidateAssetAccess(assetId);
      return { signingGeneration: generation };
    },

    createShareUrls: (assetId, masterObjectId, expiresIn, notAfterSec) =>
      createAssetShareUrls(assetId, masterObjectId, expiresIn, notAfterSec),

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
      return endpoints.map(toWebhookRecord);
    },

    getWebhook: async (id, creatorAddress) => {
      const endpoint = await getWebhookEndpointWithHealth(id, creatorAddress);
      return endpoint ? toWebhookRecord(endpoint) : null;
    },

    updateWebhook: async (id, creatorAddress, patch) => {
      const updated = await updateWebhookEndpoint(id, creatorAddress, patch);
      if (!updated) return null;
      const endpoint = await getWebhookEndpointWithHealth(updated.id, undefined);
      return endpoint ? toWebhookRecord(endpoint) : null;
    },

    rotateWebhookSecret: async (id, creatorAddress, secret) =>
      Boolean(await setWebhookSecret(id, creatorAddress, secret)),

    redeliverWebhook: async (id, creatorAddress, deliveryId) => {
      const endpoint = await getWebhookEndpointForOwner(id, creatorAddress);
      if (!endpoint) return { status: 'not_found' };
      const delivery = await getWebhookDelivery(deliveryId, endpoint.id);
      if (!delivery) return { status: 'not_found' };
      if (!endpoint.isActive) return { status: 'paused' };
      const job: WebhookJobData = {
        endpointId: endpoint.id,
        event: delivery.eventType,
        // the stored payload carries the original event id; jsonb keeps no
        // key order, so the bytes can differ, and the signature is made over
        // what is sent
        body: JSON.stringify(delivery.payload),
        deliveryId: newDeliveryId(),
        manual: true,
      };
      await ctx.webhookDispatcher.enqueue(job);
      return { status: 'queued', deliveryId: job.deliveryId! };
    },

    deleteWebhook: async (id, creatorAddress) => {
      const deleted = await deleteWebhookEndpoint(id, creatorAddress);
      return Boolean(deleted);
    },

    vetWebhookUrl: async (url) => {
      try {
        await vetUrl(url, webhookEgressPolicy(), AbortSignal.timeout(10_000));
        return null;
      } catch (err) {
        if (err instanceof EgressError) return err.message;
        throw err;
      }
    },

    testWebhook: async (id, creatorAddress) => {
      const endpoint = await getWebhookEndpointForOwner(id, creatorAddress);
      if (!endpoint) return null;
      const job = {
        endpointId: endpoint.id,
        event: 'webhook.test',
        body: eventBody('webhook.test', { webhook_id: endpoint.id }),
        deliveryId: newDeliveryId(),
      };
      const outcome = await attemptDelivery(endpoint, job, { egress: webhookEgressPolicy() });
      await createWebhookDelivery({
        webhookEndpointId: endpoint.id,
        eventType: job.event,
        payload: JSON.parse(job.body) as Record<string, unknown>,
        statusCode: outcome.statusCode,
        error: outcome.error,
        deliveredAt: outcome.delivered ? new Date() : null,
        retryCount: 0,
        manual: false,
      });
      return outcome;
    },

    listWebhookDeliveries: async (id, creatorAddress, limit) => {
      const endpoint = await getWebhookEndpointForOwner(id, creatorAddress);
      if (!endpoint) return null;
      const rows = await listWebhookDeliveries({ webhookEndpointId: endpoint.id, limit });
      return rows.map((d) => ({
        id: d.id,
        eventId: typeof d.payload.id === 'string' ? d.payload.id : null,
        event: d.eventType,
        statusCode: d.statusCode,
        error: d.error,
        attempt: d.retryCount + 1,
        createdAt: d.createdAt,
      }));
    },

    createApiKey: async (data, maxKeys) => {
      // the router already generated the key and hashes it here
      const created = await createApiKeyWithinCap(data, maxKeys);
      return created ? toKeyRecord(created) : null;
    },

    listApiKeys: async (owner, { limit, cursor }) => {
      const page = await dbListApiKeys({ creatorAddress: owner, limit, cursor });
      return {
        data: page.data.map(toKeyRecord),
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
      };
    },

    rotateApiKey: async (id, owner, replacement, retireAt) => {
      const result = await dbRotateApiKey(id, owner, replacement, retireAt);
      if (result.status !== 'rotated') return result;
      return {
        status: 'rotated',
        replacement: toKeyRecord(result.replacement),
        retiredAt: result.retiredAt,
      };
    },

    renameApiKey: async (id, owner, name) => {
      const row = await dbRenameApiKey(id, owner, name);
      return row ? toKeyRecord(row) : null;
    },

    deleteApiKey: async (id, owner) => {
      const deleted = await dbDeleteApiKey(id, owner);
      return Boolean(deleted);
    },
  };
}

/**
 * The express app with every route mounted: health, tus, the REST API, the
 * delivery gateway and metrics. Listening, timers and signals stay in
 * index.ts.
 */
export function createApp(ctx: AppContext): {
  app: Express;
  tusServer: TusServer;
  /** Close uploads that expired in progress, see buildUploadExpiry. */
  expireAbandonedUploads: (now?: Date) => Promise<number>;
} {
  const { logger } = ctx;
  const sessionManager = buildSessionManager();
  const deleteAsset = buildAssetDeleter(ctx);
  const localDevAccount = buildLocalDevAccount();
  const callers = buildCallerDeps(localDevAccount, logger);

  const app = express();
  app.disable('x-powered-by');

  // req.ip must be the real client for the per-IP limiter. TRUST_PROXY
  // defaults to the private ranges the compose proxies (nginx, and caddy in
  // front of it in production) connect from; nginx passes on the client
  // address it resolved itself.
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(express.json({ limit: '1mb' }));

  // health checks come every few seconds from docker and the web proxy, so
  // they log at debug; urls lose query values that could be capabilities
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const level = req.path === '/health' ? 'debug' : 'info';
    logger[level](
      { method: req.method, url: loggableUrl(req.url), ip: req.ip },
      'incoming request',
    );
    next();
  });

  app.get('/health', createHealthHandler(ctx.version));

  // The delivery router defines routes with /v1/ prefix in the path, so it
  // mounts at root. It comes before the api cors because it answers its own:
  // any origin, never credentials, and Range allowed on preflight.
  mountRouter(app, '/', deliveryRouter);

  app.get('/metrics', requireMetricsToken(env.METRICS_TOKEN), createPrometheusHandler(logger));

  const corsPolicy = { credentialedOrigins: env.CORS_ORIGIN, authDisabled: env.AUTH_DISABLED };
  app.use('/api', createApiCors(corsPolicy));
  app.use('/api', createCrossOriginWriteGuard(corsPolicy, env.PUBLIC_URL));
  const ipLimiter = createIpRateLimiter(env.API_IP_RATE_LIMIT);
  app.use('/api/v1', ipLimiter.count);

  setMetricSources({
    queueDepth: async () => {
      const counts = await Promise.all(
        [ctx.queues.transcode, ctx.queues.uploadSegments, ctx.queues.finalize].map((q) =>
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

  const tusServer = createTusServer(buildTusServerDeps(ctx, sessionManager, deleteAsset, callers));

  // Mount TUS server handler, a single middleware to avoid double-firing hooks.
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
      // tus authenticates inside its own hooks, so an upload request hands
      // its per-IP hit back once it turns out not to be refused
      res.on('finish', () => {
        if (res.statusCode !== 401 && res.statusCode !== 403) ipLimiter.release(req);
      });
      tusServer.handle(req, res);
    } else {
      next();
    }
  });

  // Mount API router at /api/v1 (but below the TUS handler which takes priority)
  const receivedBytes = async (id: string): Promise<number | null> => {
    try {
      return (await tusServer.datastore.getUpload(id)).offset;
    } catch {
      // no such upload on disk (an id from before uploads and sessions
      // shared one, or files already removed): keep the stored count
      return null;
    }
  };
  mountRouter(
    app,
    '/api/v1',
    createApiRouter(
      buildApiDeps(ctx, sessionManager, deleteAsset, callers, localDevAccount, receivedBytes),
      { ipLimiter },
    ),
  );

  app.use(notFoundHandler);

  app.use(createErrorHandler(logger, { exposeStacks: env.EXPOSE_ERROR_STACKS }));

  return { app, tusServer, expireAbandonedUploads: buildUploadExpiry(ctx, deleteAsset) };
}
