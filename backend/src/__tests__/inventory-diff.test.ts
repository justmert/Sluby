import { describe, it, expect } from 'vitest';
import { diffInventory } from '../reconcile/inventory-diff.js';

describe('diffInventory', () => {
  it('classifies every object id into in-sync, orphaned, or missing', () => {
    const db = ['a', 'b', 'c'];
    const indexer = ['b', 'c', 'd'];

    const result = diffInventory(db, indexer);

    // in both
    expect(result.inSync).toEqual(['b', 'c']);
    // in indexer but not tracked in the DB -> orphan candidate for cleanup
    expect(result.orphanedInIndexer).toEqual(['d']);
    // tracked in the DB but absent from the indexer -> potential data loss
    expect(result.missingFromIndexer).toEqual(['a']);
  });

  it('reports fully in-sync inventories with empty drift lists', () => {
    const result = diffInventory(['x', 'y'], ['y', 'x']);
    expect(result.inSync).toEqual(['x', 'y']);
    expect(result.orphanedInIndexer).toEqual([]);
    expect(result.missingFromIndexer).toEqual([]);
  });

  it('deduplicates repeated ids within an input', () => {
    const result = diffInventory(['a', 'a', 'b'], ['a', 'a']);
    expect(result.inSync).toEqual(['a']);
    expect(result.orphanedInIndexer).toEqual([]);
    expect(result.missingFromIndexer).toEqual(['b']);
  });

  it('returns sorted, deterministic output regardless of input order', () => {
    const result = diffInventory(['c', 'a', 'b'], ['b', 'z', 'a']);
    expect(result.inSync).toEqual(['a', 'b']);
    expect(result.orphanedInIndexer).toEqual(['z']);
    expect(result.missingFromIndexer).toEqual(['c']);
  });

  it('handles empty inventories', () => {
    expect(diffInventory([], [])).toEqual({
      inSync: [],
      orphanedInIndexer: [],
      missingFromIndexer: [],
    });
    expect(diffInventory(['a'], [])).toEqual({
      inSync: [],
      orphanedInIndexer: [],
      missingFromIndexer: ['a'],
    });
    expect(diffInventory([], ['a'])).toEqual({
      inSync: [],
      orphanedInIndexer: ['a'],
      missingFromIndexer: [],
    });
  });
});
