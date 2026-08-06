import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import {
  createReconciliationRoutes,
  type ReconciliationRouteDeps,
} from '../api/routes/reconciliation.js';
import { createTestApp, withApiKey } from './helpers/express-helpers.js';

vi.mock('../config/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const manageKey = {
  id: 'key-1',
  name: 'Test Key',
  scopes: ['read', 'upload', 'manage'],
  rateLimit: 100,
  creatorAddress: '0xabc123',
};

const sampleRun = {
  id: 'run-1',
  startedAt: new Date('2026-05-01T00:00:00Z'),
  finishedAt: new Date('2026-05-01T00:00:05Z'),
  status: 'drift',
  dbObjectCount: 10,
  indexerObjectCount: 9,
  inSyncCount: 8,
  orphanCount: 1,
  missingCount: 2,
  orphanedIds: ['orphan-1'],
  missingIds: ['missing-1', 'missing-2'],
  createdAt: new Date('2026-05-01T00:00:05Z'),
};

describe('reconciliation routes', () => {
  let deps: ReconciliationRouteDeps;

  beforeEach(() => {
    deps = {
      getLatestRun: vi.fn().mockResolvedValue(sampleRun),
      triggerRun: vi.fn().mockResolvedValue(undefined),
    };
  });

  function app(key = manageKey) {
    return withApiKey(createTestApp(createReconciliationRoutes(deps)), key);
  }

  describe('GET /reconciliation', () => {
    it('returns the latest run as snake_case', async () => {
      const res = await request(app()).get('/reconciliation');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('drift');
      expect(res.body.orphan_count).toBe(1);
      expect(res.body.missing_count).toBe(2);
      expect(res.body.orphaned_ids).toEqual(['orphan-1']);
      expect(res.body.started_at).toBe('2026-05-01T00:00:00.000Z');
    });

    it('returns 404 when no run has completed yet', async () => {
      vi.mocked(deps.getLatestRun).mockResolvedValue(null);
      const res = await request(app()).get('/reconciliation');
      expect(res.status).toBe(404);
    });

    it('requires the manage scope', async () => {
      const res = await request(app({ ...manageKey, scopes: ['read'] })).get('/reconciliation');
      expect(res.status).toBe(403);
    });
  });

  describe('POST /reconciliation/run', () => {
    it('enqueues a run and returns 202', async () => {
      const res = await request(app()).post('/reconciliation/run');

      expect(res.status).toBe(202);
      expect(deps.triggerRun).toHaveBeenCalledTimes(1);
      expect(res.body).toEqual({ enqueued: true });
    });

    it('requires the manage scope', async () => {
      const res = await request(app({ ...manageKey, scopes: ['read'] })).post(
        '/reconciliation/run',
      );
      expect(res.status).toBe(403);
    });
  });
});
