/**
 * Pure set-difference between what PostgreSQL believes it stored on Sia
 * and what the indexer actually has pinned. This is the heart of the
 * reconciliation worker: everything else (paginating the indexer, reading
 * the DB, persisting a run) is plumbing around this comparison.
 */

export interface InventoryDiff {
  /** Object ids present in BOTH the DB and the indexer. */
  inSync: string[];
  /**
   * Object ids the indexer still pins but the DB no longer tracks. These
   * are orphans: candidates for cleanup (we only flag, never auto-delete).
   */
  orphanedInIndexer: string[];
  /**
   * Object ids the DB tracks but the indexer does not report. These are
   * the alarming case: potential data loss, or an object that never
   * finished pinning.
   */
  missingFromIndexer: string[];
}

/**
 * Compare the DB's tracked object ids against the indexer's inventory.
 * Inputs may contain duplicates and arrive in any order; output lists are
 * deduplicated and sorted for deterministic, diffable results.
 */
export function diffInventory(
  dbObjectIds: Iterable<string>,
  indexerObjectIds: Iterable<string>,
): InventoryDiff {
  const db = new Set(dbObjectIds);
  const indexer = new Set(indexerObjectIds);

  const inSync: string[] = [];
  const missingFromIndexer: string[] = [];
  for (const id of db) {
    if (indexer.has(id)) inSync.push(id);
    else missingFromIndexer.push(id);
  }

  const orphanedInIndexer: string[] = [];
  for (const id of indexer) {
    if (!db.has(id)) orphanedInIndexer.push(id);
  }

  const sort = (arr: string[]) => arr.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    inSync: sort(inSync),
    orphanedInIndexer: sort(orphanedInIndexer),
    missingFromIndexer: sort(missingFromIndexer),
  };
}
