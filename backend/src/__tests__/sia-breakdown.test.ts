import { describe, it, expect } from 'vitest';
import {
  buildSiaBreakdown,
  SECTOR_SIZE_BYTES,
  type ObjectSnapshot,
  type SlabSnapshot,
} from '../storage/sia-breakdown.js';

const slab = (roots: string[], hosts: string[], minShards = 2): SlabSnapshot => ({
  minShards,
  offset: 0,
  length: 10,
  sectors: roots.map((root, i) => ({ root, hostKey: hosts[i] })),
});

const obj = (
  id: string,
  size: number,
  encodedSize: number,
  slabs: SlabSnapshot[],
): ObjectSnapshot => ({
  id,
  size,
  encodedSize,
  slabs,
  createdAt: '2026-10-01T00:00:00.000Z',
});

describe('buildSiaBreakdown', () => {
  // two playlists packed into one slab, plus a media object with its own slab
  const shared = slab(['r1', 'r2', 'r3', 'r4', 'r5', 'r6'], ['A', 'B', 'C', 'D', 'E', 'F']);
  const media = slab(['m1', 'm2', 'm3', 'm4', 'm5', 'm6'], ['A', 'B', 'C', 'G', 'H', 'I']);
  const refs = [
    { objectId: 'pl-720', role: 'variant_playlist' as const, rendition: '720p' },
    { objectId: 'pl-360', role: 'variant_playlist' as const, rendition: '360p' },
    { objectId: 'data-720', role: 'rendition_data' as const, rendition: '720p' },
  ];
  const snapshots = new Map<string, ObjectSnapshot | null>([
    ['pl-720', obj('pl-720', 300, 900, [shared])],
    ['pl-360', obj('pl-360', 200, 600, [shared])],
    ['data-720', obj('data-720', 5000, 15000, [media])],
  ]);
  const hosts = [
    { publicKey: 'A', countryCode: 'DE', latitude: 0, longitude: 0, goodForUpload: true },
    { publicKey: 'B', countryCode: 'DE', latitude: 0, longitude: 0, goodForUpload: true },
    { publicKey: 'G', countryCode: 'US', latitude: 0, longitude: 0, goodForUpload: false },
  ];
  const b = buildSiaBreakdown(refs, snapshots, hosts);

  it('counts a shared slab once in the totals', () => {
    expect(b.totals.uniqueSlabCount).toBe(2);
    expect(b.totals.uniqueSectorCount).toBe(12);
  });

  it('flags the shared slab on each object that uses it', () => {
    const byId = Object.fromEntries(b.objects.map((o) => [o.objectId, o]));
    expect(byId['pl-720'].sharedSlabCount).toBe(1);
    expect(byId['pl-360'].sharedSlabCount).toBe(1);
    expect(byId['data-720'].sharedSlabCount).toBe(0);
  });

  it('sums sizes, and counts encoded bytes once per unique slab', () => {
    expect(b.totals.rawBytes).toBe(5500);
    // per-object encoded sizes (900 + 600 + 15000) would count the shared slab twice
    expect(b.totals.encodedBytes).toBe(12 * SECTOR_SIZE_BYTES);
  });

  it('reads redundancy from the shard config', () => {
    expect(b.totals).toMatchObject({ dataShards: 2, parityShards: 4, redundancyRatio: 3 });
  });

  it('distributes sectors over hosts and countries', () => {
    expect(b.hosts.find((h) => h.publicKey === 'A')).toMatchObject({
      sectors: 2,
      countryCode: 'DE',
    });
    expect(b.hosts.find((h) => h.publicKey === 'D')).toMatchObject({
      sectors: 1,
      countryCode: null,
    });
    expect(b.totals.hostCount).toBe(9);
    expect(b.countries).toEqual([
      { countryCode: 'DE', hosts: 2, sectors: 4 },
      { countryCode: 'US', hosts: 1, sectors: 1 },
    ]);
  });

  it('reports objects the indexer could not describe', () => {
    const partial = buildSiaBreakdown(refs, new Map([...snapshots, ['data-720', null]]), hosts);
    expect(partial.unavailable).toEqual(['data-720']);
    expect(partial.objects).toHaveLength(2);
    expect(partial.totals.objectCount).toBe(3);
  });

  it('does not invent a redundancy ratio when slabs disagree', () => {
    const mixed = buildSiaBreakdown(
      [{ objectId: 'x', role: null, rendition: null }],
      new Map([['x', obj('x', 1, 3, [slab(['a', 'b', 'c'], ['A', 'B', 'C'], 1), media])]]),
      [],
    );
    expect(mixed.totals.redundancyRatio).toBeNull();
    expect(mixed.totals.dataShards).toBeNull();
  });
});
