import { readJson } from './errors.js';
import type {
  MissingObject,
  ReconciliationReport,
  ReconciliationTrigger,
  RequestOptions,
} from './types.js';
import type { FetchFn } from './uploads.js';

/**
 * The storage check: the backend's comparison of the objects its videos
 * track against what the Sia indexer holds. Needs the `manage` scope.
 */
export class ReconciliationManager {
  private readonly _fetch: FetchFn;

  constructor(fetchFn: FetchFn) {
    this._fetch = fetchFn;
  }

  /**
   * The latest finished check. The platform identity and operators get the
   * whole deployment (`scope: 'deployment'`); any other caller gets only its
   * own missing objects (`scope: 'account'`). Rejects with a `NotFoundError`
   * before the first check has finished.
   */
  async latest(options?: RequestOptions): Promise<ReconciliationReport> {
    const res = await this._fetch('/api/v1/reconciliation', { signal: options?.signal });
    const raw = await readJson(res);
    const common = {
      id: raw.id as string,
      startedAt: raw.started_at as string,
      finishedAt: raw.finished_at as string,
      createdAt: raw.created_at as string,
      status: raw.status as ReconciliationReport['status'],
      missingCount: raw.missing_count as number,
      missingIds: raw.missing_ids as string[],
      missingObjects: (raw.missing_objects as Array<Record<string, unknown>>).map(mapMissing),
    };
    if (raw.scope === 'deployment') {
      return {
        ...common,
        scope: 'deployment',
        dbObjectCount: raw.db_object_count as number,
        indexerObjectCount: raw.indexer_object_count as number,
        inSyncCount: raw.in_sync_count as number,
        orphanCount: raw.orphan_count as number,
        orphanedIds: raw.orphaned_ids as string[],
        errorMessage: (raw.error_message as string | null | undefined) ?? null,
      };
    }
    return { ...common, scope: 'account' };
  }

  /** Queue a check now. Only the platform identity and operators may. */
  async run(options?: RequestOptions): Promise<ReconciliationTrigger> {
    const res = await this._fetch('/api/v1/reconciliation/run', {
      method: 'POST',
      signal: options?.signal,
    });
    const raw = await readJson(res);
    return { enqueued: raw.enqueued === true, alreadyPending: raw.already_pending === true };
  }
}

function mapMissing(raw: Record<string, unknown>): MissingObject {
  return {
    objectId: raw.object_id as string,
    videoAssetId: (raw.video_asset_id as string | null | undefined) ?? null,
    title: (raw.title as string | null | undefined) ?? null,
  };
}
