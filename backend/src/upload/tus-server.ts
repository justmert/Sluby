import { randomUUID } from 'node:crypto';
import { Server, EVENTS, type Upload } from '@tus/server';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { computeFileHash } from './chunk-verifier.js';
import { UPLOAD_EXPIRY_MS, UploadFileStore } from './upload-store.js';
import { resolveCaller, type CallerDeps } from '../api/auth/caller.js';
import { currentOwnerAddress } from '../api/auth/access.js';
import { PLATFORM_ADDRESS } from '../api/ownership.js';
import { accessTierSchema, descriptionSchema, titleSchema } from '../api/validation.js';
import { uploadBytesTotal, uploadFailureTotal, uploadSuccessTotal } from '../metrics/collector.js';

export interface TusServerDeps {
  /** How a request's caller is resolved, shared with the REST api (see resolveCaller). */
  callers: CallerDeps;
  /**
   * Create the asset and its upload session. The session takes the tus
   * upload id as its own id, so the id in the tus Location is also the one
   * the REST status and cancel routes take.
   */
  createUploadSession: (data: {
    id: string;
    apiKeyId: string;
    fileSize: number;
    /** where tus writes the upload, recorded up front so a deleted asset can remove a partial one */
    filePath: string;
    metadata: Record<string, string>;
    title: string;
    description: string;
    accessTier: 'public' | 'private';
  }) => Promise<{ id: string; videoAssetId?: string }>;
  updateUploadProgress: (uploadId: string, uploadedBytes: number) => Promise<void>;
  completeUpload: (uploadId: string, filePath: string, sha256: string) => Promise<void>;
  cancelUpload: (uploadId: string) => Promise<void>;
  /**
   * The rows of a creation exist but the upload never made it to disk: mark
   * the session failed and discard the asset.
   */
  abandonUpload: (sessionId: string, videoAssetId: string | undefined) => Promise<void>;
  enqueueTranscoding: (data: {
    videoAssetId: string;
    uploadSessionId: string;
    filePath: string;
    creatorAddress: string;
    accessTier: string;
  }) => Promise<void>;
  /** Mark an asset failed so a finish-time error does not leave it stuck. */
  markAssetFailed: (videoAssetId: string) => Promise<void>;
  /** Delete the asset an upload created, when the uploader cancels it. */
  discardAsset: (videoAssetId: string) => Promise<void>;
  /** Deliver an event to the webhooks of `owner`, the uploading account. */
  dispatchWebhook: (event: string, data: Record<string, unknown>, owner: string) => Promise<void>;
}

/** Where the file store keeps the data of upload `id`. */
export const uploadFilePath = (id: string) => `${env.UPLOAD_DIR}/${id}`;

/**
 * Check the creation metadata with the same rules as PATCH /assets, so a bad
 * value is a 400 rather than a database error. A missing or blank title
 * becomes "Untitled"; the tier may come as accessTier or access_tier.
 */
export function parseUploadMetadata(metadata: Record<string, string | null | undefined>): {
  title: string;
  description: string;
  accessTier: 'public' | 'private';
} {
  const rawTitle = metadata.title ?? '';
  let title = 'Untitled';
  if (rawTitle.trim() !== '') {
    const parsed = titleSchema.safeParse(rawTitle);
    if (!parsed.success) throw tusError(400, parsed.error.issues[0].message);
    title = parsed.data;
  }

  const description = descriptionSchema.safeParse(metadata.description ?? '');
  if (!description.success) throw tusError(400, description.error.issues[0].message);

  const tier = accessTierSchema.safeParse(metadata.accessTier ?? metadata.access_tier ?? 'public');
  if (!tier.success) throw tusError(400, 'accessTier must be public or private');

  return { title, description: description.data, accessTier: tier.data };
}

/** An error @tus/server turns into a response by itself, see its error handler. */
function isTusError(err: unknown): boolean {
  return typeof (err as { status_code?: unknown } | null)?.status_code === 'number';
}

export function createTusServer(deps: TusServerDeps): Server {
  // creations whose rows exist but whose upload is not on disk yet: the
  // POST_CREATE event clears an entry, an error response abandons it
  const pendingCreates = new WeakMap<object, { sessionId: string; videoAssetId?: string }>();
  const publicBase = env.PUBLIC_URL.replace(/\/$/, '');

  const server = new Server({
    path: '/api/v1/uploads',
    datastore: new UploadFileStore({
      directory: env.UPLOAD_DIR,
      expirationPeriodInMilliseconds: UPLOAD_EXPIRY_MS,
      log: logger,
    }),
    maxSize: env.MAX_UPLOAD_SIZE,
    // the session row takes this id, and session ids are uuids
    namingFunction: () => randomUUID(),
    // the upload url is the public origin, like every other url the api
    // hands out; forwarded headers are client input on a directly reached
    // backend
    respectForwardedHeaders: false,
    generateUrl(_req, { path, id }) {
      return `${publicBase}${path}/${id}`;
    },
    // a finished upload is the source a processing or failed asset still
    // needs, and deleting an asset takes the manage scope, not upload
    disableTerminationForFinishedUploads: true,

    async onResponseError(req, err) {
      const pending = pendingCreates.get(req);
      if (pending) {
        pendingCreates.delete(req);
        try {
          await deps.abandonUpload(pending.sessionId, pending.videoAssetId);
        } catch (abandonErr) {
          logger.error(
            { ...pending, err: abandonErr },
            'Could not discard a failed upload creation',
          );
        }
      }
      if (isTusError(err)) return undefined;
      // the default body appends the raw error message, which can carry file
      // paths or a failed SQL statement
      logger.error({ err, method: req.method, url: req.url }, 'tus request failed');
      return { status_code: 500, body: 'Internal server error\n' };
    },

    async onIncomingRequest(req, uploadId: string) {
      await authorizeTusRequest(req, uploadId, deps, (id) => server.datastore.getUpload(id));
    },

    async onUploadCreate(req, upload) {
      const apiKey = (req as unknown as Record<string, unknown>).__apiKey as {
        id: string;
        creatorAddress: string;
      };

      // Parse TUS metadata
      const metadata = upload.metadata ?? {};

      // Validate file type
      const fileType = metadata.filetype ?? metadata.type ?? '';
      if (fileType && !fileType.startsWith('video/')) {
        throw { status_code: 415, body: 'Only video files are accepted' };
      }
      // tus would call an empty upload finished at creation and queue a
      // transcode that can only fail
      if (upload.size === 0) {
        throw tusError(400, 'The file is empty');
      }
      const fields = parseUploadMetadata(metadata);

      // Ownership always comes from the authenticated API key, never from
      // client-supplied TUS metadata. Honouring a client-provided
      // creatorAddress would let any caller stamp another tenant's address on
      // an asset, which defeats the ownership checks on every /assets route.
      const creatorAddress = apiKey.creatorAddress;

      // Create upload session in database
      const session = await deps.createUploadSession({
        id: upload.id,
        apiKeyId: apiKey.id,
        fileSize: upload.size ?? 0,
        filePath: uploadFilePath(upload.id),
        metadata: {
          ...(metadata as Record<string, string>),
          creatorAddress,
        },
        ...fields,
      });
      pendingCreates.set(req, { sessionId: session.id, videoAssetId: session.videoAssetId });

      logger.info(
        {
          uploadId: upload.id,
          sessionId: session.id,
          fileSize: upload.size,
          creatorAddress,
          metadata,
        },
        'Upload session created',
      );

      // Store session ID in upload metadata for later retrieval
      const updatedMetadata = {
        ...metadata,
        sessionId: session.id,
        videoAssetId: session.videoAssetId ?? '',
        creatorAddress,
      };

      // upload.started goes out from POST_CREATE, once the upload exists
      return { metadata: updatedMetadata };
    },

    async onUploadFinish(req, upload) {
      const metadata = upload.metadata ?? {};
      const sessionId = metadata.sessionId;
      const videoAssetId = metadata.videoAssetId;
      // an upload started before its owner's account claimed a legacy address
      // still names that address on disk
      const creatorAddress = metadata.creatorAddress
        ? await currentOwnerAddress(metadata.creatorAddress, deps.callers)
        : undefined;
      const accessTier = metadata.accessTier ?? metadata.access_tier ?? 'public';

      if (!sessionId) {
        logger.error({ uploadId: upload.id }, 'No session ID found in upload metadata');
        return {};
      }

      try {
        // Compute SHA-256 of the completed file by streaming it. Reading the
        // whole upload into a Buffer would use memory proportional to the file
        // and throws outright past Node's max Buffer length, which uploads up
        // to MAX_UPLOAD_SIZE (10 GB by default) can easily exceed.
        const filePath = uploadFilePath(upload.id);
        const sha256 = await computeFileHash(filePath);
        if (upload.size != null) await deps.updateUploadProgress(sessionId, upload.size);

        // Mark upload as complete
        await deps.completeUpload(sessionId, filePath, sha256);
        uploadSuccessTotal.inc();
        if (upload.size != null) uploadBytesTotal.inc(upload.size);

        logger.info(
          { uploadId: upload.id, sessionId, sha256, fileSize: upload.size },
          'Upload completed, enqueueing transcoding',
        );

        // Enqueue transcoding job
        if (videoAssetId) {
          await deps.enqueueTranscoding({
            videoAssetId,
            uploadSessionId: sessionId,
            filePath,
            creatorAddress: creatorAddress ?? '',
            accessTier,
          });
        }

        await deps.dispatchWebhook(
          'upload.completed',
          {
            upload_id: upload.id,
            session_id: sessionId,
            video_asset_id: videoAssetId,
            sha256,
            file_size: upload.size,
          },
          creatorAddress ?? '',
        );

        return {};
      } catch (err) {
        // A failure here (hashing, completion, enqueue) would otherwise leave
        // the asset stuck in 'created' with no job. Mark it failed so it is
        // visible and retryable, then rethrow so TUS surfaces the error.
        logger.error(
          { uploadId: upload.id, sessionId, videoAssetId, err },
          'onUploadFinish failed',
        );
        uploadFailureTotal.inc();
        if (videoAssetId) {
          try {
            await deps.markAssetFailed(videoAssetId);
          } catch (markErr) {
            logger.error({ videoAssetId, markErr }, 'Failed to mark asset failed');
          }
        }
        await deps
          .dispatchWebhook(
            'upload.failed',
            {
              upload_id: upload.id,
              session_id: sessionId,
              video_asset_id: videoAssetId ?? null,
              error: err instanceof Error ? err.message : String(err),
            },
            creatorAddress ?? '',
          )
          .catch((hookErr) => logger.warn({ hookErr }, 'upload.failed webhook not sent'));
        throw err;
      }
    },
  });

  // the store created the upload, so the creation stands and can be announced
  server.on(EVENTS.POST_CREATE, (req, upload: Upload) => {
    pendingCreates.delete(req);
    const metadata = upload.metadata ?? {};
    void deps
      .dispatchWebhook(
        'upload.started',
        {
          upload_id: upload.id,
          session_id: metadata.sessionId ?? upload.id,
          video_asset_id: metadata.videoAssetId || null,
          file_size: upload.size,
        },
        metadata.creatorAddress ?? '',
      )
      .catch((err) => logger.warn({ uploadId: upload.id, err }, 'upload.started webhook not sent'));
  });

  // keep the REST upload status (GET /uploads/:id) in step with the bytes
  // actually received; tus throttles this event per postReceiveInterval
  server.on(EVENTS.POST_RECEIVE, (_req, upload: Upload) => {
    const sessionId = upload.metadata?.sessionId;
    if (!sessionId || upload.offset == null) return;
    deps.updateUploadProgress(sessionId, upload.offset).catch((err) => {
      logger.warn({ uploadId: upload.id, err }, 'Failed to record upload progress');
    });
  });

  return server;
}

type Identity = { id: string; creatorAddress: string; scopes: string[] };

/** A tus hook failure, in the shape @tus/server turns into a response. */
const tusError = (status_code: number, body: string) => ({ status_code, body });

async function resolveIdentity(req: Request, deps: TusServerDeps): Promise<Identity> {
  const result = await resolveCaller(
    {
      cookie: req.headers.get('cookie') ?? undefined,
      authorization: req.headers.get('authorization') ?? undefined,
    },
    deps.callers,
  );
  if (!result.ok) throw tusError(401, result.error);
  const { caller } = result;
  if (!caller.scopes.includes('upload')) {
    throw tusError(403, 'API key does not have upload scope');
  }
  return { id: caller.id, creatorAddress: caller.creatorAddress, scopes: caller.scopes };
}

/**
 * Authenticate a tus request and, for requests on an existing upload, check
 * the caller owns it. On termination (DELETE) the upload's session is
 * cancelled and the asset it created is discarded, so a cancelled upload does
 * not leave an empty asset behind in the library.
 */
export async function authorizeTusRequest(
  req: Request,
  uploadId: string,
  deps: TusServerDeps,
  getUpload: (id: string) => Promise<Upload>,
): Promise<void> {
  if (req.method === 'OPTIONS') return;

  const identity = await resolveIdentity(req, deps);
  (req as unknown as Record<string, unknown>).__apiKey = identity;

  // creation (POST) has no upload yet; every other method targets one
  if (req.method === 'POST' || !uploadId) return;

  let upload: Upload;
  try {
    upload = await getUpload(uploadId);
  } catch {
    // unknown id: let the tus handler answer with its own 404/410
    return;
  }

  const stored = upload.metadata?.creatorAddress;
  const owner = stored ? await currentOwnerAddress(stored, deps.callers) : undefined;
  if (identity.creatorAddress !== PLATFORM_ADDRESS && owner !== identity.creatorAddress) {
    // same answer as a missing upload, so ids cannot be probed across tenants
    throw tusError(404, 'Upload not found');
  }

  if (req.method === 'DELETE') {
    // tus refuses to terminate a finished upload, see
    // disableTerminationForFinishedUploads; its asset must stay as well
    if (upload.size !== undefined && upload.offset === upload.size) return;
    const sessionId = upload.metadata?.sessionId;
    const videoAssetId = upload.metadata?.videoAssetId;
    if (sessionId) await deps.cancelUpload(sessionId);
    if (videoAssetId) await deps.discardAsset(videoAssetId);
    logger.info({ uploadId, sessionId, videoAssetId }, 'Upload cancelled by the uploader');
  }
}
