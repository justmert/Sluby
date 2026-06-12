import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { logger } from '../config/logger.js';

export interface UploadSessionRecord {
  id: string;
  videoAssetId: string | null;
  uploadUrl: string;
  filePath: string | null;
  fileSize: number;
  uploadedBytes: number;
  sha256Hash: string | null;
  status: 'uploading' | 'completed' | 'cancelled' | 'failed';
  metadata: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
}

export interface SessionManagerDeps {
  insertSession: (session: Omit<UploadSessionRecord, 'createdAt' | 'updatedAt'>) => Promise<void>;
  getSession: (id: string) => Promise<UploadSessionRecord | null>;
  updateSession: (id: string, data: Partial<UploadSessionRecord>) => Promise<void>;
}

export class SessionManager {
  constructor(private deps: SessionManagerDeps) {}

  async create(params: {
    apiKeyId: string;
    fileSize: number;
    metadata: Record<string, string>;
    videoAssetId?: string;
    uploadBaseUrl?: string;
  }): Promise<{ id: string; uploadUrl: string; videoAssetId?: string }> {
    const id = randomUUID();
    const uploadUrl = `${params.uploadBaseUrl ?? ''}/api/v1/uploads/${id}`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h expiry

    await this.deps.insertSession({
      id,
      videoAssetId: params.videoAssetId ?? null,
      uploadUrl,
      filePath: null,
      fileSize: params.fileSize,
      uploadedBytes: 0,
      sha256Hash: null,
      status: 'uploading',
      metadata: { ...params.metadata, apiKeyId: params.apiKeyId },
      expiresAt,
    });

    logger.info({ sessionId: id, fileSize: params.fileSize }, 'Upload session created');

    return { id, uploadUrl, videoAssetId: params.videoAssetId };
  }

  async getStatus(sessionId: string): Promise<{
    id: string;
    status: string;
    progressPercent: number;
    fileSize: number;
    uploadedBytes: number;
    videoAssetId: string | null;
  } | null> {
    const session = await this.deps.getSession(sessionId);
    if (!session) return null;

    const progressPercent = session.fileSize > 0
      ? Math.round((session.uploadedBytes / session.fileSize) * 100)
      : 0;

    return {
      id: session.id,
      status: session.status,
      progressPercent,
      fileSize: session.fileSize,
      uploadedBytes: session.uploadedBytes,
      videoAssetId: session.videoAssetId,
    };
  }

  async resume(sessionId: string): Promise<{ uploadUrl: string } | null> {
    const session = await this.deps.getSession(sessionId);
    if (!session || session.status !== 'uploading') return null;

    return { uploadUrl: session.uploadUrl };
  }

  async cancel(sessionId: string): Promise<void> {
    const session = await this.deps.getSession(sessionId);
    if (!session) return;

    await this.deps.updateSession(sessionId, { status: 'cancelled' });

    // Clean up partial file
    if (session.filePath) {
      try {
        await unlink(session.filePath);
      } catch {
        // File may not exist
      }
    }

    logger.info({ sessionId }, 'Upload session cancelled');
  }

  async complete(sessionId: string, filePath: string, sha256: string): Promise<void> {
    await this.deps.updateSession(sessionId, {
      status: 'completed',
      filePath,
      sha256Hash: sha256,
    });

    logger.info({ sessionId, filePath, sha256 }, 'Upload session completed');
  }

  async updateProgress(sessionId: string, uploadedBytes: number): Promise<void> {
    await this.deps.updateSession(sessionId, { uploadedBytes });
  }
}
