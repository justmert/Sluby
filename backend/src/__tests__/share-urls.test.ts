import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/queries/assets.js', () => ({ getAssetObjectIds: vi.fn() }));
vi.mock('../storage/sia-client.js', () => ({ shareObjectUrl: vi.fn() }));

import { createAssetShareUrls } from '../delivery/share-urls.js';
import { getAssetObjectIds } from '../db/queries/assets.js';
import { shareObjectUrl } from '../storage/sia-client.js';

const mockedIds = vi.mocked(getAssetObjectIds);
const mockedShare = vi.mocked(shareObjectUrl);

beforeEach(() => {
  vi.clearAllMocks();
  mockedShare.mockImplementation(async (objectId: string) => `sia://${objectId}#key`);
});

describe('createAssetShareUrls', () => {
  it('mints one share URL per object and echoes the master + expiry', async () => {
    mockedIds.mockResolvedValue(['manifest-obj', 'data-obj', 'thumb-obj']);

    const before = Date.now();
    const result = await createAssetShareUrls('asset-x', 'manifest-obj', 3600);

    expect(result.masterObjectId).toBe('manifest-obj');
    expect(result.shares).toEqual({
      'manifest-obj': 'sia://manifest-obj#key',
      'data-obj': 'sia://data-obj#key',
      'thumb-obj': 'sia://thumb-obj#key',
    });
    expect(mockedShare).toHaveBeenCalledTimes(3);
    // Every object is shared with the same validUntil ~ now + expiresIn.
    const validUntil = mockedShare.mock.calls[0][1] as Date;
    expect(validUntil.getTime()).toBeGreaterThanOrEqual(before + 3600_000 - 2000);
    expect(new Date(result.expiresAt).getTime()).toBe(validUntil.getTime());
  });

  it('serves a cached map for repeat calls in the same window (no re-mint)', async () => {
    mockedIds.mockResolvedValue(['a', 'b']);

    const first = await createAssetShareUrls('asset-cache', 'a', 3600);
    const second = await createAssetShareUrls('asset-cache', 'a', 3600);

    expect(second).toEqual(first);
    // Two objects minted once, not twice.
    expect(mockedShare).toHaveBeenCalledTimes(2);
    expect(mockedIds).toHaveBeenCalledTimes(1);
  });

  it('re-mints for a different asset', async () => {
    mockedIds.mockResolvedValue(['a']);

    await createAssetShareUrls('asset-1', 'a', 3600);
    await createAssetShareUrls('asset-2', 'a', 3600);

    expect(mockedIds).toHaveBeenCalledTimes(2);
  });
});
