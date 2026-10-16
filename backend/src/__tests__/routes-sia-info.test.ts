import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, withApiKey } from './helpers/express-helpers.js';
import {
  createSiaInfoRoutes,
  clearSiaInfoCache,
  objectRefs,
  type SiaInfoAssetRecord,
  type SiaInfoRouteDeps,
} from '../api/routes/sia-info.js';
import type { ObjectSnapshot } from '../storage/sia-breakdown.js';

vi.mock('../config/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const asset: SiaInfoAssetRecord = {
  id: 'asset-1',
  manifestObjectId: 'master',
  thumbnailObjectIds: ['thumb'],
  siaObjectIds: ['master', 'data-720', 'thumb'],
  status: 'ready',
};

const snapshot = (id: string, roots: string[]): ObjectSnapshot => ({
  id,
  size: 100,
  encodedSize: 300,
  slabs: [
    {
      minShards: 10,
      offset: 0,
      length: 100,
      sectors: roots.map((root, i) => ({ root, hostKey: `h${i}` })),
    },
  ],
  createdAt: '2026-10-01T00:00:00.000Z',
});

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
      getAssetArtifacts: vi.fn().mockResolvedValue([
        { objectId: 'master', role: 'master_manifest', renditionName: null },
        { objectId: 'data-720', role: 'rendition_data', renditionName: '720p' },
      ]),
      inspectSiaObject: vi.fn(async (id: string) => snapshot(id, [`${id}-a`, `${id}-b`])),
      listSiaHosts: vi
        .fn()
        .mockResolvedValue([
          { publicKey: 'h0', countryCode: 'DE', latitude: 1, longitude: 2, goodForUpload: true },
        ]),
      getHostContracts: vi.fn().mockResolvedValue(null),
      getWalletAddress: vi.fn().mockResolvedValue(null),
      siaIndexer: { url: 'https://sia.storage', network: 'mainnet' },
    };
  });

  const app = (creator: string) =>
    withApiKey(createTestApp(createSiaInfoRoutes(deps)), keyFor(creator));

  it('serves the owner a breakdown built from the indexer', async () => {
    const res = await request(app('github:owner')).get('/asset-1/sia');
    expect(res.status).toBe(200);
    expect(res.body.objects.map((o: { role: string }) => o.role)).toEqual([
      'master_manifest',
      'rendition_data',
    ]);
    expect(res.body.totals).toMatchObject({
      object_count: 2,
      raw_bytes: 200,
      encoded_bytes: 4 * 4 * 1024 * 1024,
      unique_slab_count: 2,
      unique_sector_count: 4,
    });
    expect(res.body.countries).toEqual([{ country_code: 'DE', hosts: 1, sectors: 2 }]);
    expect(res.body.contracts).toBeNull();
  });

  it('does not leak a cached breakdown to another tenant', async () => {
    expect((await request(app('github:owner')).get('/asset-1/sia')).status).toBe(200);

    const res = await request(app('github:intruder')).get('/asset-1/sia');

    expect(res.status).toBe(404);
    expect(deps.getAssetWithSiaIds).toHaveBeenLastCalledWith('asset-1', 'github:intruder');
  });

  it('reuses a complete breakdown but retries a partial one', async () => {
    await request(app('github:owner')).get('/asset-1/sia');
    await request(app('github:owner')).get('/asset-1/sia');
    expect(deps.inspectSiaObject).toHaveBeenCalledTimes(2);

    clearSiaInfoCache();
    vi.mocked(deps.inspectSiaObject).mockReset();
    vi.mocked(deps.inspectSiaObject).mockRejectedValue(new Error('indexer down'));
    const first = await request(app('github:owner')).get('/asset-1/sia');
    expect(first.body.unavailable_object_ids).toEqual(['master', 'data-720']);
    await request(app('github:owner')).get('/asset-1/sia');
    expect(deps.inspectSiaObject).toHaveBeenCalledTimes(4);
  });

  it('lists only contracts on hosts that hold this asset', async () => {
    vi.mocked(deps.getHostContracts).mockResolvedValue(
      new Map([
        ['h0', ['fc-1']],
        ['elsewhere', ['fc-9']],
      ]),
    );
    const res = await request(app('github:owner')).get('/asset-1/sia');
    expect(res.body.contracts).toEqual(['fc-1']);
  });
});

describe('objectRefs', () => {
  it('falls back to the asset row for assets stored before artifacts existed', () => {
    expect(objectRefs(asset, [])).toEqual([
      { objectId: 'master', role: 'master_manifest', rendition: null },
      { objectId: 'thumb', role: 'thumbnail', rendition: null },
      { objectId: 'data-720', role: null, rendition: null },
    ]);
  });

  it('lists backfilled objects with no recorded role after the known ones', () => {
    expect(
      objectRefs(asset, [
        { objectId: 'data-720', role: null, renditionName: null },
        { objectId: 'thumb', role: 'thumbnail', renditionName: null },
        { objectId: 'master', role: 'master_manifest', renditionName: null },
      ]),
    ).toEqual([
      { objectId: 'master', role: 'master_manifest', rendition: null },
      { objectId: 'thumb', role: 'thumbnail', rendition: null },
      { objectId: 'data-720', role: null, rendition: null },
    ]);
  });
});
