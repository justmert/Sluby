import { describe, it, expect } from 'vitest';
import { diffInventory, type IndexerObjectState } from '../reconcile/inventory-diff.js';

const settledBefore = new Date('2026-05-01T12:00:00Z');
const old = new Date('2026-05-01T09:00:00Z');
const recent = new Date('2026-05-01T12:30:00Z');

const pinned = (ids: string[], at = old): Map<string, IndexerObjectState> =>
  new Map(ids.map((id) => [id, { deleted: false, eventAt: at }]));

describe('diffInventory', () => {
  it('classifies every object id into in-sync, orphaned, or missing', () => {
    const result = diffInventory(['a', 'b', 'c'], pinned(['b', 'c', 'd']), settledBefore);

    // in both
    expect(result.inSync).toEqual(['b', 'c']);
    // in indexer but not tracked in the DB -> orphan candidate for cleanup
    expect(result.orphanedInIndexer).toEqual(['d']);
    // tracked in the DB but absent from the indexer -> potential data loss
    expect(result.missingFromIndexer).toEqual(['a']);
    expect(result.inFlight).toEqual([]);
  });

  it('reports fully in-sync inventories with empty drift lists', () => {
    const result = diffInventory(['x', 'y'], pinned(['y', 'x']), settledBefore);
    expect(result.inSync).toEqual(['x', 'y']);
    expect(result.orphanedInIndexer).toEqual([]);
    expect(result.missingFromIndexer).toEqual([]);
  });

  it('deduplicates repeated ids in the DB input', () => {
    const result = diffInventory(['a', 'a', 'b'], pinned(['a']), settledBefore);
    expect(result.inSync).toEqual(['a']);
    expect(result.missingFromIndexer).toEqual(['b']);
  });

  it('returns sorted, deterministic output regardless of input order', () => {
    const result = diffInventory(['c', 'a', 'b'], pinned(['b', 'z', 'a']), settledBefore);
    expect(result.inSync).toEqual(['a', 'b']);
    expect(result.orphanedInIndexer).toEqual(['z']);
    expect(result.missingFromIndexer).toEqual(['c']);
  });

  it('handles empty inventories', () => {
    const none = { inSync: [], orphanedInIndexer: [], missingFromIndexer: [], inFlight: [] };
    expect(diffInventory([], new Map(), settledBefore)).toEqual(none);
    expect(diffInventory(['a'], new Map(), settledBefore)).toEqual({
      ...none,
      missingFromIndexer: ['a'],
    });
    expect(diffInventory([], pinned(['a']), settledBefore)).toEqual({
      ...none,
      orphanedInIndexer: ['a'],
    });
  });

  it('counts an object deleted long ago, and still tracked, as missing', () => {
    const indexer = new Map([['a', { deleted: true, eventAt: old }]]);
    expect(diffInventory(['a'], indexer, settledBefore).missingFromIndexer).toEqual(['a']);
  });

  it('ignores a deleted object nobody tracks', () => {
    const indexer = new Map([['a', { deleted: true, eventAt: old }]]);
    const result = diffInventory([], indexer, settledBefore);
    expect(result.orphanedInIndexer).toEqual([]);
    expect(result.inFlight).toEqual([]);
  });

  describe('within the grace window', () => {
    it('does not call an object pinned but not yet recorded an orphan', () => {
      const result = diffInventory([], pinned(['uploading'], recent), settledBefore);
      expect(result.orphanedInIndexer).toEqual([]);
      expect(result.inFlight).toEqual(['uploading']);
    });

    it('does not call an object unpinned but not yet forgotten missing', () => {
      const indexer = new Map([['deleting', { deleted: true, eventAt: recent }]]);
      const result = diffInventory(['deleting'], indexer, settledBefore);
      expect(result.missingFromIndexer).toEqual([]);
      expect(result.inFlight).toEqual(['deleting']);
    });

    it('still counts a recently pinned object the DB tracks as in sync', () => {
      const result = diffInventory(['a'], pinned(['a'], recent), settledBefore);
      expect(result.inSync).toEqual(['a']);
      expect(result.inFlight).toEqual([]);
    });
  });
});
