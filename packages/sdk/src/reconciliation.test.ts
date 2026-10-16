import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReconciliationManager } from './reconciliation.js';
import type { FetchFn } from './uploads.js';

let mockFetch: ReturnType<typeof vi.fn<FetchFn>>;

function makeJsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

const times = {
  id: 'run-1',
  started_at: '2026-10-09T00:00:00.000Z',
  finished_at: '2026-10-09T00:00:05.000Z',
  created_at: '2026-10-09T00:00:05.000Z',
};

beforeEach(() => {
  mockFetch = vi.fn<FetchFn>();
});

describe('ReconciliationManager.latest()', () => {
  it('maps an account report with the video of each missing object', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        ...times,
        scope: 'account',
        status: 'drift',
        missing_count: 2,
        missing_ids: ['o1', 'o2'],
        missing_objects: [
          { object_id: 'o1', video_asset_id: 'v1', title: 'One' },
          { object_id: 'o2', video_asset_id: null, title: null },
        ],
      }),
    );
    const report = await new ReconciliationManager(mockFetch).latest();
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/reconciliation', { signal: undefined });
    expect(report).toEqual({
      id: 'run-1',
      startedAt: '2026-10-09T00:00:00.000Z',
      finishedAt: '2026-10-09T00:00:05.000Z',
      createdAt: '2026-10-09T00:00:05.000Z',
      scope: 'account',
      status: 'drift',
      missingCount: 2,
      missingIds: ['o1', 'o2'],
      missingObjects: [
        { objectId: 'o1', videoAssetId: 'v1', title: 'One' },
        { objectId: 'o2', videoAssetId: null, title: null },
      ],
    });
  });

  it('maps the deployment figures for the platform identity', async () => {
    mockFetch.mockResolvedValueOnce(
      makeJsonResponse({
        ...times,
        scope: 'deployment',
        status: 'ok',
        db_object_count: 10,
        indexer_object_count: 11,
        in_sync_count: 10,
        orphan_count: 1,
        missing_count: 0,
        error_message: null,
        missing_ids: [],
        missing_objects: [],
        orphaned_ids: ['x'],
      }),
    );
    const report = await new ReconciliationManager(mockFetch).latest();
    expect(report).toMatchObject({
      scope: 'deployment',
      dbObjectCount: 10,
      indexerObjectCount: 11,
      inSyncCount: 10,
      orphanCount: 1,
      orphanedIds: ['x'],
      errorMessage: null,
      missingObjects: [],
    });
  });
});

describe('ReconciliationManager.run()', () => {
  it('posts and maps the answer', async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ enqueued: false, already_pending: true }));
    expect(await new ReconciliationManager(mockFetch).run()).toEqual({
      enqueued: false,
      alreadyPending: true,
    });
    expect(mockFetch).toHaveBeenCalledWith('/api/v1/reconciliation/run', {
      method: 'POST',
      signal: undefined,
    });
  });
});
