import { Server } from '@tus/server';
import { FileStore } from '@tus/file-store';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

export interface TusServerDeps {
  validateApiKey: (token: string) => Promise<{ id: string; creatorAddress: string; scopes: string[] } | null>;
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

      // Use creator address from TUS metadata (frontend Settings) if provided,
      // otherwise fall back to the API key's creator address
      const creatorAddress =
        (metadata.creatorAddress && metadata.creatorAddress !== '' && !metadata.creatorAddress.match(/^0x0+$/))
          ? metadata.creatorAddress
          : apiKey.creatorAddress;

      // Create upload session in database
      const session = await deps.createUploadSession({
        apiKeyId: apiKey.id,
        fileSize: upload.size ?? 0,
        metadata: {
          ...metadata as Record<string, string>,
          creatorAddress,
        },
      });

      logger.info({
        uploadId: upload.id,
        sessionId: session.id,
        fileSize: upload.size,
        creatorAddress,
        metadata,
      }, 'Upload session created');

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

      // Compute SHA-256 hash of the completed file
      const filePath = `${env.UPLOAD_DIR}/${upload.id}`;
      const fileData = await readFile(filePath);
      const sha256 = createHash('sha256').update(fileData).digest('hex');

      // Mark upload as complete
      await deps.completeUpload(sessionId, filePath, sha256);

      logger.info({
        uploadId: upload.id,
        sessionId,
        sha256,
        fileSize: upload.size,
      }, 'Upload completed, enqueueing transcoding');

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
