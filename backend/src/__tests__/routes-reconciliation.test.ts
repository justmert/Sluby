import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import {
  createReconciliationRoutes,
  type ReconciliationRouteDeps,
} from '../api/routes/reconciliation.js';
import { PLATFORM_ADDRESS } from '../api/ownership.js';
import { openapiDocument } from '../api/openapi.js';
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

const platformKey = { ...manageKey, id: 'key-platform', creatorAddress: PLATFORM_ADDRESS };

// an operator stays an ordinary tenant by address, see operators.ts
const operatorKey = { ...manageKey, id: 'key-operator', operator: true };

const aggregates = {
  id: 'run-1',
  started_at: '2026-05-01T00:00:00.000Z',
  finished_at: '2026-05-01T00:00:05.000Z',
  status: 'drift',
  db_object_count: 10,
  indexer_object_count: 9,
  in_sync_count: 8,
  orphan_count: 1,
  missing_count: 2,
  error_message: null,
  created_at: '2026-05-01T00:00:05.000Z',
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
  errorMessage: null,
  createdAt: new Date('2026-05-01T00:00:05Z'),
};

describe('reconciliation routes', () => {
  let deps: ReconciliationRouteDeps;

  beforeEach(() => {
    deps = {
      getLatestRun: vi.fn().mockResolvedValue(sampleRun),
      // stands in for the postgres ownership query, which has its own tests
      filterReconciliationIdsOwnedBy: vi.fn().mockResolvedValue(['missing-2']),
      triggerRun: vi.fn().mockResolvedValue({ enqueued: true }),
    };
  });

  function app(key: typeof manageKey & { operator?: boolean } = manageKey) {
    return withApiKey(createTestApp(createReconciliationRoutes(deps)), key);
  }

  describe('GET /reconciliation', () => {
    it('gives a tenant only its own drift, none of the deployment figures', async () => {
      const res = await request(app()).get('/reconciliation');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: 'run-1',
        started_at: '2026-05-01T00:00:00.000Z',
        finished_at: '2026-05-01T00:00:05.000Z',
        created_at: '2026-05-01T00:00:05.000Z',
        scope: 'account',
        status: 'drift',
        missing_count: 1,
        missing_ids: ['missing-2'],
      });
      expect(deps.filterReconciliationIdsOwnedBy).toHaveBeenCalledWith(
        ['missing-1', 'missing-2'],
        '0xabc123',
      );
    });

    it('tells a tenant with nothing missing that it is in sync, whatever the others have', async () => {
      vi.mocked(deps.filterReconciliationIdsOwnedBy).mockResolvedValue([]);
      const res = await request(app()).get('/reconciliation');

      expect(res.body).toMatchObject({
        scope: 'account',
        status: 'ok',
        missing_count: 0,
        missing_ids: [],
      });
    });

    it('tells a tenant a run failed, without its error text', async () => {
      vi.mocked(deps.getLatestRun).mockResolvedValue({
        ...sampleRun,
        status: 'failed',
        errorMessage: 'connect ECONNREFUSED 10.0.0.7:9980',
      });
      vi.mocked(deps.filterReconciliationIdsOwnedBy).mockResolvedValue([]);
      const res = await request(app()).get('/reconciliation');

      expect(res.body.status).toBe('failed');
      expect(JSON.stringify(res.body)).not.toContain('10.0.0.7');
    });

    it('scopes an empty creator address to that address, not to the deployment', async () => {
      vi.mocked(deps.filterReconciliationIdsOwnedBy).mockResolvedValue([]);
      const res = await request(app({ ...manageKey, creatorAddress: '' })).get('/reconciliation');

      expect(res.body.scope).toBe('account');
      expect(res.body).not.toHaveProperty('orphaned_ids');
      expect(deps.filterReconciliationIdsOwnedBy).toHaveBeenCalledWith(
        ['missing-1', 'missing-2'],
        '',
      );
    });

    it('gives the platform identity the full report', async () => {
      const res = await request(app(platformKey)).get('/reconciliation');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ...aggregates,
        scope: 'deployment',
        missing_ids: ['missing-1', 'missing-2'],
        orphaned_ids: ['orphan-1'],
      });
      expect(deps.filterReconciliationIdsOwnedBy).not.toHaveBeenCalled();
    });

    it('gives an operator the full report too', async () => {
      const res = await request(app(operatorKey)).get('/reconciliation');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ...aggregates,
        scope: 'deployment',
        missing_ids: ['missing-1', 'missing-2'],
        orphaned_ids: ['orphan-1'],
      });
      expect(deps.filterReconciliationIdsOwnedBy).not.toHaveBeenCalled();
    });

    it('matches the documented schema for both scopes', async () => {
      const schemas = openapiDocument.components.schemas;
      for (const [key, schema] of [
        [manageKey, schemas.ReconciliationRunAccount],
        [platformKey, schemas.ReconciliationRunDeployment],
      ] as const) {
        const res = await request(app(key)).get('/reconciliation');
        expect(Object.keys(schema.properties)).toEqual(
          expect.arrayContaining(Object.keys(res.body)),
        );
        expect(Object.keys(res.body)).toEqual(expect.arrayContaining([...schema.required]));
      }
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
    it('refuses a tenant: a run scans the whole deployment', async () => {
      const res = await request(app()).post('/reconciliation/run');

      expect(res.status).toBe(403);
      expect(deps.triggerRun).not.toHaveBeenCalled();
    });

    it('answers 202 and says a new run was queued', async () => {
      const res = await request(app(platformKey)).post('/reconciliation/run');

      expect(res.status).toBe(202);
      expect(deps.triggerRun).toHaveBeenCalledTimes(1);
      expect(res.body).toEqual({ enqueued: true, already_pending: false });
    });

    it('lets an operator start one', async () => {
      const res = await request(app(operatorKey)).post('/reconciliation/run');

      expect(res.status).toBe(202);
      expect(deps.triggerRun).toHaveBeenCalledTimes(1);
    });

    it('answers 202 and says a run was already pending when nothing was queued', async () => {
      vi.mocked(deps.triggerRun).mockResolvedValue({ enqueued: false });
      const res = await request(app(platformKey)).post('/reconciliation/run');

      expect(res.status).toBe(202);
      expect(res.body).toEqual({ enqueued: false, already_pending: true });
    });

    it('matches the documented schema', async () => {
      const schema = openapiDocument.components.schemas.ReconciliationTrigger;
      const res = await request(app(platformKey)).post('/reconciliation/run');
      expect(Object.keys(res.body).sort()).toEqual(Object.keys(schema.properties).sort());
    });

    it('requires the manage scope', async () => {
      const res = await request(app({ ...platformKey, scopes: ['read'] })).post(
        '/reconciliation/run',
      );
      expect(res.status).toBe(403);
    });
  });
});
