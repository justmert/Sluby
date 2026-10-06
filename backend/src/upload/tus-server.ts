import { Server, EVENTS, type Upload } from '@tus/server';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { computeFileHash } from './chunk-verifier.js';
import { UPLOAD_EXPIRY_MS, UploadFileStore } from './upload-store.js';
import { resolveSession, type FindActiveSession } from '../api/auth/session.js';
import { PLATFORM_ADDRESS } from '../api/ownership.js';
import { uploadBytesTotal, uploadFailureTotal, uploadSuccessTotal } from '../metrics/collector.js';

export interface TusServerDeps {
  /** The live Studio session row for a session id, see resolveSession. */
  findActiveSession: FindActiveSession;
  validateApiKey: (
    token: string,
  ) => Promise<{ id: string; creatorAddress: string; scopes: string[] } | null>;
  createUploadSession: (data: {
    apiKeyId: string;
    fileSize: number;
    /** where tus writes the upload, recorded up front so a deleted asset can remove a partial one */
    filePath: string;
    metadata: Record<string, string>;
  }) => Promise<{ id: string; videoAssetId?: string }>;
  updateUploadProgress: (uploadId: string, uploadedBytes: number) => Promise<void>;
  completeUpload: (uploadId: string, filePath: string, sha256: string) => Promise<void>;
  cancelUpload: (uploadId: string) => Promise<void>;
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

export function createTusServer(deps: TusServerDeps): Server {
  const server = new Server({
    path: '/api/v1/uploads',
    datastore: new UploadFileStore({
      directory: env.UPLOAD_DIR,
      expirationPeriodInMilliseconds: UPLOAD_EXPIRY_MS,
      log: logger,
    }),
    maxSize: env.MAX_UPLOAD_SIZE,
    respectForwardedHeaders: true,
    generateUrl(req, { proto, host, path, id }) {
      // Only upgrade to https when behind a reverse proxy (e.g. Cloudflare)
      const forwarded = req.headers.get('x-forwarded-proto');
      const protocol = forwarded === 'https' ? 'https' : proto;
      return `${protocol}://${host}${path}/${id}`;
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

      // Ownership always comes from the authenticated API key, never from
      // client-supplied TUS metadata. Honouring a client-provided
      // creatorAddress would let any caller stamp another tenant's address on
      // an asset, which defeats the ownership checks on every /assets route.
      const creatorAddress = apiKey.creatorAddress;

      // Create upload session in database
      const session = await deps.createUploadSession({
        apiKeyId: apiKey.id,
        fileSize: upload.size ?? 0,
        filePath: uploadFilePath(upload.id),
        metadata: {
          ...(metadata as Record<string, string>),
          creatorAddress,
        },
      });

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

      await deps.dispatchWebhook(
        'upload.started',
        {
          upload_id: upload.id,
          session_id: session.id,
          video_asset_id: session.videoAssetId ?? null,
          file_size: upload.size,
        },
        creatorAddress,
      );

      return { metadata: updatedMetadata };
    },

    async onUploadFinish(req, upload) {
      const metadata = upload.metadata ?? {};
      const sessionId = metadata.sessionId;
      const videoAssetId = metadata.videoAssetId;
      const creatorAddress = metadata.creatorAddress;
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
  // Session cookie path: when the Studio UI drives the upload, the browser
  // sends the signed session cookie. We materialise an identity with full
  // upload scope that downstream hooks treat like an API-key caller.
  const session = await resolveSession(req.headers.get('cookie') ?? undefined, {
    secret: env.SESSION_SECRET,
    allowedUsers: env.GITHUB_ALLOWED_USERS,
    findActiveSession: deps.findActiveSession,
  });
  if (session) {
    return {
      id: `session:${session.login}`,
      creatorAddress: `github:${session.login.toLowerCase()}`,
      scopes: ['upload', 'read', 'manage'],
    };
  }

  if (env.AUTH_DISABLED) {
    return {
      id: 'session:dev',
      creatorAddress: 'github:dev',
      scopes: ['upload', 'read', 'manage'],
    };
  }

  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw tusError(401, 'Missing or invalid Authorization header');
  }
  const apiKey = await deps.validateApiKey(authHeader.slice(7));
  if (!apiKey) throw tusError(401, 'Invalid API key');
  if (!apiKey.scopes.includes('upload')) {
    throw tusError(403, 'API key does not have upload scope');
  }
  return apiKey;
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

  const owner = upload.metadata?.creatorAddress;
  if (identity.creatorAddress !== PLATFORM_ADDRESS && owner !== identity.creatorAddress) {
    // same answer as a missing upload, so ids cannot be probed across tenants
    throw tusError(404, 'Upload not found');
  }

  if (req.method === 'DELETE') {
    const sessionId = upload.metadata?.sessionId;
    const videoAssetId = upload.metadata?.videoAssetId;
    if (sessionId) await deps.cancelUpload(sessionId);
    if (videoAssetId) await deps.discardAsset(videoAssetId);
    logger.info({ uploadId, sessionId, videoAssetId }, 'Upload cancelled by the uploader');
  }
}
