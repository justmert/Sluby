import { Server } from '@tus/server';
import { FileStore } from '@tus/file-store';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { computeFileHash } from './chunk-verifier.js';
import { SESSION_COOKIE_NAME, parseCookieHeader, verifySession } from '../api/auth/session.js';

export interface TusServerDeps {
  validateApiKey: (
    token: string,
  ) => Promise<{ id: string; creatorAddress: string; scopes: string[] } | null>;
  createUploadSession: (data: {
    apiKeyId: string;
    fileSize: number;
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
  dispatchWebhook: (event: string, data: Record<string, unknown>) => Promise<void>;
}

export function createTusServer(deps: TusServerDeps): Server {
  const server = new Server({
    path: '/api/v1/uploads',
    datastore: new FileStore({ directory: env.UPLOAD_DIR }),
    maxSize: env.MAX_UPLOAD_SIZE,
    respectForwardedHeaders: true,
    generateUrl(req, { proto, host, path, id }) {
      // Only upgrade to https when behind a reverse proxy (e.g. Cloudflare)
      const forwarded = req.headers.get('x-forwarded-proto');
      const protocol = forwarded === 'https' ? 'https' : proto;
      return `${protocol}://${host}${path}/${id}`;
    },

    async onIncomingRequest(req, _uploadId: string) {
      // Validate API key for all requests except OPTIONS
      if (req.method === 'OPTIONS') return;

      // Session cookie path: when the Studio UI drives the upload, the
      // browser sends the signed session cookie. We materialise an
      // identity with full upload scope that downstream hooks can treat
      // identically to an API-key caller.
      const cookies = parseCookieHeader(req.headers.get('cookie') ?? undefined);
      const session = verifySession(cookies[SESSION_COOKIE_NAME], env.SESSION_SECRET);
      if (session) {
        (req as unknown as Record<string, unknown>).__apiKey = {
          id: `session:${session.login}`,
          creatorAddress: `github:${session.login.toLowerCase()}`,
          scopes: ['upload', 'read', 'manage'],
        };
        return;
      }

      // Dev bypass.
      if (env.AUTH_DISABLED) {
        (req as unknown as Record<string, unknown>).__apiKey = {
          id: 'session:dev',
          creatorAddress: 'github:dev',
          scopes: ['upload', 'read', 'manage'],
        };
        return;
      }

      const authHeader = req.headers.get('authorization');
      if (!authHeader?.startsWith('Bearer ')) {
        throw { status_code: 401, body: 'Missing or invalid Authorization header' };
      }

      const token = authHeader.slice(7);
      const apiKey = await deps.validateApiKey(token);
      if (!apiKey) {
        throw { status_code: 401, body: 'Invalid API key' };
      }

      if (!apiKey.scopes.includes('upload')) {
        throw { status_code: 403, body: 'API key does not have upload scope' };
      }

      // Attach API key info to request for downstream hooks
      (req as unknown as Record<string, unknown>).__apiKey = apiKey;
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

      await deps.dispatchWebhook('upload.started', {
        upload_id: upload.id,
        session_id: session.id,
        file_size: upload.size,
      });

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

      // Compute SHA-256 of the completed file by streaming it. Reading the
      // whole upload into a Buffer would use memory proportional to the file
      // and throws outright past Node's max Buffer length, which uploads up
      // to MAX_UPLOAD_SIZE (10 GB by default) can easily exceed.
      const filePath = `${env.UPLOAD_DIR}/${upload.id}`;
      const sha256 = await computeFileHash(filePath);

      // Mark upload as complete
      await deps.completeUpload(sessionId, filePath, sha256);

      logger.info(
        {
          uploadId: upload.id,
          sessionId,
          sha256,
          fileSize: upload.size,
        },
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

      await deps.dispatchWebhook('upload.completed', {
        upload_id: upload.id,
        session_id: sessionId,
        video_asset_id: videoAssetId,
        sha256,
        file_size: upload.size,
      });

      return {};
    },
  });

  return server;
}
