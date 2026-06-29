import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UploadManager } from './uploads.js';
import type { FetchFn } from './uploads.js';

// ---------------------------------------------------------------------------
// Mock fetch function (the internal _fetch passed from the client)
// ---------------------------------------------------------------------------

let mockFetch: ReturnType<typeof vi.fn<FetchFn>>;

function makeJsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

beforeEach(() => {
  mockFetch = vi.fn<FetchFn>();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UploadManager.create()', () => {
  it('should POST to /api/v1/uploads with snake_case body', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        video_asset_id: 'vid_123',
        upload_url: 'https://tus.sluby.app/upload/abc',
      }),
    );

    const manager = new UploadManager(mockFetch, 'sluby_key');
    const result = await manager.create({
      title: 'My Video',
      description: 'A test video',
      accessTier: 'public',
    });

    // Verify the request
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'My Video',
        description: 'A test video',
        access_tier: 'public',
      }),
    });

    // Verify snake_case -> camelCase mapping
    expect(result).toEqual({
      videoAssetId: 'vid_123',
      uploadUrl: 'https://tus.sluby.app/upload/abc',
    });
  });

  it('should send correct body when no optional fields provided', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        video_asset_id: 'vid_456',
        upload_url: 'https://tus.sluby.app/upload/def',
      }),
    );

    const manager = new UploadManager(mockFetch, 'sluby_key');
    await manager.create({
      title: 'Public Video',
      description: 'Public',
      accessTier: 'public',
    });

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init!.body as string);
    expect(body).toEqual({
      title: 'Public Video',
      description: 'Public',
      access_tier: 'public',
    });
  });
});

describe('UploadManager.getStatus()', () => {
  it('should GET /api/v1/uploads/:id and map snake_case response', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        id: 'upload_1',
        video_asset_id: 'vid_1',
        upload_url: 'https://tus.example.com/u',
        status: 'uploading',
        progress_percent: 45,
        file_size: 10000000,
        uploaded_bytes: 4500000,
      }),
    );

    const manager = new UploadManager(mockFetch, 'sluby_key');
    const result = await manager.getStatus('upload_1');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/uploads/upload_1');

    expect(result).toEqual({
      id: 'upload_1',
      videoAssetId: 'vid_1',
      uploadUrl: 'https://tus.example.com/u',
      status: 'uploading',
      progressPercent: 45,
      fileSize: 10000000,
      uploadedBytes: 4500000,
    });
  });

  it('should encode special characters in upload ID', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        id: 'a/b',
        video_asset_id: 'v',
        upload_url: 'u',
        status: 'created',
        progress_percent: 0,
        file_size: 0,
        uploaded_bytes: 0,
      }),
    );

    const manager = new UploadManager(mockFetch, 'sluby_key');
    await manager.getStatus('a/b');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/uploads/a%2Fb');
  });
});

describe('UploadManager.cancel()', () => {
  it('should DELETE /api/v1/uploads/:id', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({}));

    const manager = new UploadManager(mockFetch, 'sluby_key');
    await manager.cancel('upload_1');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/uploads/upload_1', {
      method: 'DELETE',
    });
  });

  it('should encode the upload ID', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({}));

    const manager = new UploadManager(mockFetch, 'sluby_key');
    await manager.cancel('id with spaces');

    expect(mockFetch).toHaveBeenCalledWith('/api/v1/uploads/id%20with%20spaces', {
      method: 'DELETE',
    });
  });
});
