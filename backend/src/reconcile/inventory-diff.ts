/**
 * Pure comparison between what PostgreSQL believes it stored on Sia and what
 * the indexer reports. This is the heart of the reconciliation worker:
 * everything else (reading the indexer's feed, reading the DB, persisting a
 * run) is plumbing around this comparison.
 */

/** The indexer's latest event for one object. */
export interface IndexerObjectState {
  deleted: boolean;
  /** When the indexer recorded that event. */
  eventAt: Date;
}

export interface InventoryDiff {
  /** Object ids the DB tracks and the indexer has pinned. */
  inSync: string[];
  /**
   * Object ids the indexer still pins but the DB does not track. These
   * are orphans: candidates for cleanup (we only flag, never auto-delete).
   */
  orphanedInIndexer: string[];
  /**
   * Object ids the DB tracks but the indexer does not report as pinned.
   * These are the alarming case: potential data loss, or an object that
   * never finished pinning.
   */
  missingFromIndexer: string[];
  /**
   * Object ids left out of both lists because the indexer changed them after
   * `settledBefore`: pinned by an upload whose finalize has not recorded them
   * yet, or unpinned by a deletion that has not forgotten them yet. Pinned
   * ids in `pending` count here too, however old their pin.
   */
  inFlight: string[];
}

/**
 * Compare the DB's tracked object ids against the indexer's inventory.
 * `settledBefore` is the end of the grace window: an indexer change after it
 * is work in progress rather than drift. The DB ids must be read before the
 * indexer's, so anything recorded or forgotten in between shows up as such a
 * recent change. Inputs may contain duplicates and arrive in any order;
 * output lists are deduplicated and sorted for deterministic, diffable
 * results.
 */
export function diffInventory(
  dbObjectIds: Iterable<string>,
  indexer: ReadonlyMap<string, IndexerObjectState>,
  settledBefore: Date,
  /** Ids the pipeline still owns: never orphans, and never missing since they may not be pinned yet. */
  pending: ReadonlySet<string> = new Set(),
): InventoryDiff {
  const db = new Set(dbObjectIds);
  const recent = (s: IndexerObjectState) => s.eventAt > settledBefore;

  const inSync: string[] = [];
  const missingFromIndexer: string[] = [];
  const inFlight: string[] = [];
  for (const id of db) {
    const state = indexer.get(id);
    if (state && !state.deleted) inSync.push(id);
    else if (state && recent(state)) inFlight.push(id);
    else missingFromIndexer.push(id);
  }

  const orphanedInIndexer: string[] = [];
  for (const [id, state] of indexer) {
    if (state.deleted || db.has(id)) continue;
    if (recent(state) || pending.has(id)) inFlight.push(id);
    else orphanedInIndexer.push(id);
  }

  const sort = (arr: string[]) => arr.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return {
    inSync: sort(inSync),
    orphanedInIndexer: sort(orphanedInIndexer),
    missingFromIndexer: sort(missingFromIndexer),
    inFlight: sort(inFlight),
  };
}
