import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, withApiKey } from './helpers/express-helpers.js';

vi.mock('../config/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const sia = vi.hoisted(() => ({
  getObject: vi.fn(),
  downloadObject: vi.fn(),
  getWalletAddress: vi.fn().mockResolvedValue(null),
}));
vi.mock('../storage/sia-client.js', () => sia);

import {
  createSiaInfoRoutes,
  clearSiaInfoCache,
  type SiaInfoAssetRecord,
  type SiaInfoRouteDeps,
} from '../api/routes/sia-info.js';

const asset: SiaInfoAssetRecord = {
  id: 'asset-1',
  manifestObjectId: null,
  thumbnailObjectIds: [],
  siaObjectIds: [],
  totalStorageBytes: 0,
  status: 'ready',
};

function keyFor(creatorAddress: string) {
  return { id: 'k', name: 'k', scopes: ['read'], rateLimit: 100, creatorAddress };
}

describe('GET /assets/:id/sia', () => {
  let deps: SiaInfoRouteDeps;

  beforeEach(() => {
    clearSiaInfoCache();
    deps = {
      getAssetWithSiaIds: vi.fn(async (_id: string, owner?: string) =>
        owner === 'github:owner' ? asset : null,
      ),
    };
  });

  const app = (creator: string) =>
    withApiKey(createTestApp(createSiaInfoRoutes(deps)), keyFor(creator));

  it('serves the owner', async () => {
    const res = await request(app('github:owner')).get('/asset-1/sia');
    expect(res.status).toBe(200);
    expect(res.body.manifestObjectId).toBeNull();
  });

  it('does not leak a cached breakdown to another tenant', async () => {
    // warm the cache as the owner
    expect((await request(app('github:owner')).get('/asset-1/sia')).status).toBe(200);

    const res = await request(app('github:intruder')).get('/asset-1/sia');

    expect(res.status).toBe(404);
    expect(deps.getAssetWithSiaIds).toHaveBeenLastCalledWith('asset-1', 'github:intruder');
  });

  it('reuses the cached breakdown for the owner', async () => {
    await request(app('github:owner')).get('/asset-1/sia');
    await request(app('github:owner')).get('/asset-1/sia');
    // built once: the wallet lookup is part of the build, not the cache hit
    expect(sia.getWalletAddress).toHaveBeenCalledTimes(1);
  });
});
