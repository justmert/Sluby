import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Mock logger
vi.mock('../config/logger.js', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  SessionManager,
  type SessionManagerDeps,
  type UploadSessionRecord,
} from '../upload/session-manager.js';
import { logger } from '../config/logger.js';

function createMockSession(overrides: Partial<UploadSessionRecord> = {}): UploadSessionRecord {
  return {
    id: 'session-1',
    videoAssetId: 'asset-1',
    uploadUrl: '/api/v1/uploads/session-1',
    filePath: '/uploads/session-1/video.mp4',
    fileSize: 1024 * 1024 * 100, // 100 MB
    uploadedBytes: 0,
    sha256Hash: null,
    status: 'uploading',
    metadata: { apiKeyId: 'key-1' },
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: new Date(Date.now() + 86400_000),
    ...overrides,
  };
}

describe('SessionManager', () => {
  let deps: SessionManagerDeps;
  let manager: SessionManager;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = {
      insertSession: vi.fn().mockResolvedValue(undefined),
      getSession: vi.fn().mockResolvedValue(null),
      updateSession: vi.fn().mockResolvedValue(undefined),
    };
    manager = new SessionManager(deps);
  });

  describe('create', () => {
    it('should create a new upload session with a UUID', async () => {
      const result = await manager.create({
        apiKeyId: 'key-1',
        fileSize: 5_000_000,
        metadata: { title: 'My Video' },
      });

      expect(result.id).toBeDefined();
      expect(typeof result.id).toBe('string');
      expect(result.id.length).toBeGreaterThan(0);
      expect(result.uploadUrl).toContain(result.id);
    });

    it('should include the uploadBaseUrl in the upload URL', async () => {
      const result = await manager.create({
        apiKeyId: 'key-1',
        fileSize: 1000,
        metadata: {},
        uploadBaseUrl: 'https://api.sluby.app',
      });

      expect(result.uploadUrl).toMatch(/^https:\/\/api\.sluby\.app\/api\/v1\/uploads\//);
    });

    it('should call insertSession with correct data', async () => {
      await manager.create({
        apiKeyId: 'key-1',
        fileSize: 5_000_000,
        metadata: { format: 'mp4' },
        videoAssetId: 'asset-abc',
      });

      expect(deps.insertSession).toHaveBeenCalledWith(
        expect.objectContaining({
          fileSize: 5_000_000,
          uploadedBytes: 0,
          status: 'uploading',
          videoAssetId: 'asset-abc',
          filePath: null,
          sha256Hash: null,
          metadata: expect.objectContaining({ apiKeyId: 'key-1', format: 'mp4' }),
        }),
      );
    });

    it('records the upload file path when given one', async () => {
      await manager.create({
        apiKeyId: 'key-1',
        fileSize: 1000,
        filePath: '/uploads/abc123',
        metadata: {},
      });

      expect(deps.insertSession).toHaveBeenCalledWith(
        expect.objectContaining({ filePath: '/uploads/abc123' }),
      );
    });

    it('should set videoAssetId to null when not provided', async () => {
      await manager.create({
        apiKeyId: 'key-1',
        fileSize: 1000,
        metadata: {},
      });

      expect(deps.insertSession).toHaveBeenCalledWith(
        expect.objectContaining({ videoAssetId: null }),
      );
    });

    it('should set expiresAt to 24 hours in the future', async () => {
      const before = Date.now();
      await manager.create({
        apiKeyId: 'key-1',
        fileSize: 1000,
        metadata: {},
      });
      const after = Date.now();

      const insertedData = vi.mocked(deps.insertSession).mock.calls[0][0];
      const expiresAt = insertedData.expiresAt.getTime();
      const expected24h = 24 * 60 * 60 * 1000;

      expect(expiresAt).toBeGreaterThanOrEqual(before + expected24h);
      expect(expiresAt).toBeLessThanOrEqual(after + expected24h);
    });

    it('should return the videoAssetId when provided', async () => {
      const result = await manager.create({
        apiKeyId: 'key-1',
        fileSize: 1000,
        metadata: {},
        videoAssetId: 'asset-xyz',
      });

      expect(result.videoAssetId).toBe('asset-xyz');
    });
  });

  describe('getStatus', () => {
    it('should return null when session does not exist', async () => {
      vi.mocked(deps.getSession).mockResolvedValue(null);

      const result = await manager.getStatus('nonexistent');
      expect(result).toBeNull();
    });

    it('returns null for another tenant’s session (owner mismatch)', async () => {
      vi.mocked(deps.getSession).mockResolvedValue(
        createMockSession({ metadata: { apiKeyId: 'key-1', creatorAddress: '0xowner' } }),
      );

      const result = await manager.getStatus('session-1', '0xattacker');
      expect(result).toBeNull();
    });

    it('should return session status with progress', async () => {
      const session = createMockSession({
        fileSize: 1000,
        uploadedBytes: 500,
      });
      vi.mocked(deps.getSession).mockResolvedValue(session);

      const result = await manager.getStatus('session-1');

      expect(result).toEqual({
        id: 'session-1',
        status: 'uploading',
        progressPercent: 50,
        fileSize: 1000,
        uploadedBytes: 500,
        videoAssetId: 'asset-1',
      });
    });

    it('should calculate 0% progress when fileSize is 0', async () => {
      const session = createMockSession({ fileSize: 0, uploadedBytes: 0 });
      vi.mocked(deps.getSession).mockResolvedValue(session);

      const result = await manager.getStatus('session-1');
      expect(result?.progressPercent).toBe(0);
    });

    it('should round progress to nearest integer', async () => {
      const session = createMockSession({
        fileSize: 3,
        uploadedBytes: 1,
      });
      vi.mocked(deps.getSession).mockResolvedValue(session);

      const result = await manager.getStatus('session-1');
      expect(result?.progressPercent).toBe(33); // Math.round(1/3 * 100)
    });

    it('should return 100% when fully uploaded', async () => {
      const session = createMockSession({
        fileSize: 1000,
        uploadedBytes: 1000,
      });
      vi.mocked(deps.getSession).mockResolvedValue(session);

      const result = await manager.getStatus('session-1');
      expect(result?.progressPercent).toBe(100);
    });
  });

  describe('cancel', () => {
    it('should do nothing when session does not exist', async () => {
      vi.mocked(deps.getSession).mockResolvedValue(null);

      await manager.cancel('nonexistent');

      expect(deps.updateSession).not.toHaveBeenCalled();
    });

    it('should update status to cancelled', async () => {
      vi.mocked(deps.getSession).mockResolvedValue(createMockSession());

      await manager.cancel('session-1');

      expect(deps.updateSession).toHaveBeenCalledWith('session-1', { status: 'cancelled' });
    });

    describe('with files on disk', () => {
      let dir: string;
      beforeEach(() => {
        dir = mkdtempSync(path.join(tmpdir(), 'sluby-cancel-'));
      });
      afterEach(() => {
        rmSync(dir, { recursive: true, force: true });
      });

      it('deletes the partial upload and its tus sidecar', async () => {
        const filePath = path.join(dir, 'abc123');
        writeFileSync(filePath, 'partial');
        writeFileSync(`${filePath}.json`, '{}');
        vi.mocked(deps.getSession).mockResolvedValue(createMockSession({ filePath }));

        await expect(manager.cancel('session-1')).resolves.toEqual({
          status: 'cancelled',
          videoAssetId: 'asset-1',
        });

        expect(existsSync(filePath)).toBe(false);
        expect(existsSync(`${filePath}.json`)).toBe(false);
      });

      it('leaves the files to the tus file store when asked to', async () => {
        const filePath = path.join(dir, 'abc123');
        writeFileSync(filePath, 'partial');
        writeFileSync(`${filePath}.json`, '{}');
        vi.mocked(deps.getSession).mockResolvedValue(createMockSession({ filePath }));

        await expect(
          manager.cancel('session-1', undefined, { removeFiles: false }),
        ).resolves.toEqual({ status: 'cancelled', videoAssetId: 'asset-1' });

        expect(deps.updateSession).toHaveBeenCalledWith('session-1', { status: 'cancelled' });
        expect(existsSync(filePath)).toBe(true);
        expect(existsSync(`${filePath}.json`)).toBe(true);
      });

      it('logs with the path and still cancels when the file can not be removed', async () => {
        // a non-empty directory where the upload should be makes rm fail for real
        const filePath = path.join(dir, 'stuck');
        mkdirSync(filePath);
        writeFileSync(path.join(filePath, 'inner'), 'x');
        vi.mocked(deps.getSession).mockResolvedValue(createMockSession({ filePath }));

        await expect(manager.cancel('session-1')).resolves.toEqual({
          status: 'cancelled',
          videoAssetId: 'asset-1',
        });

        expect(deps.updateSession).toHaveBeenCalledWith('session-1', { status: 'cancelled' });
        expect(logger.error).toHaveBeenCalledWith(
          expect.objectContaining({ path: filePath, err: expect.any(Error) }),
          'Failed to remove source upload file',
        );
      });
    });

    it('does not touch the disk when the session has no file path', async () => {
      vi.mocked(deps.getSession).mockResolvedValue(createMockSession({ filePath: null }));

      await expect(manager.cancel('session-1')).resolves.toEqual({
        status: 'cancelled',
        videoAssetId: 'asset-1',
      });

      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalledWith(expect.anything(), 'Removed source upload');
    });

    it('does not cancel another tenant’s session (owner mismatch)', async () => {
      vi.mocked(deps.getSession).mockResolvedValue(
        createMockSession({ metadata: { apiKeyId: 'key-1', creatorAddress: '0xowner' } }),
      );

      const result = await manager.cancel('session-1', '0xattacker');

      expect(result).toEqual({ status: 'not_found' });
      expect(deps.updateSession).not.toHaveBeenCalled();
    });

    it('scopes an empty owner to that owner rather than to every session', async () => {
      vi.mocked(deps.getSession).mockResolvedValue(
        createMockSession({ metadata: { apiKeyId: 'key-1', creatorAddress: '0xowner' } }),
      );
      expect(await manager.cancel('session-1', '')).toEqual({ status: 'not_found' });
      expect(await manager.getStatus('session-1', '')).toBeNull();
      expect(deps.updateSession).not.toHaveBeenCalled();
    });

    it.each(['completed', 'cancelled', 'failed'] as const)(
      'refuses a %s session and leaves its file alone',
      async (status) => {
        vi.mocked(deps.getSession).mockResolvedValue(createMockSession({ status }));

        const result = await manager.cancel('session-1');

        expect(result).toEqual({ status: 'not_uploading', sessionStatus: status });
        expect(deps.updateSession).not.toHaveBeenCalled();
      },
    );
  });

  describe('complete', () => {
    it('should update session with completed status, filePath, and hash', async () => {
      await manager.complete('session-1', '/uploads/final.mp4', 'abc123hash');

      expect(deps.updateSession).toHaveBeenCalledWith('session-1', {
        status: 'completed',
        filePath: '/uploads/final.mp4',
        sha256Hash: 'abc123hash',
      });
    });
  });

  describe('updateProgress', () => {
    it('should update the uploadedBytes for the session', async () => {
      await manager.updateProgress('session-1', 50_000);

      expect(deps.updateSession).toHaveBeenCalledWith('session-1', {
        uploadedBytes: 50_000,
      });
    });
  });
});
