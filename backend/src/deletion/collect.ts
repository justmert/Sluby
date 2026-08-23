/**
 * Pure helper: merge every source of Sia object ids for a single asset into a
 * deduped list, dropping empty/nullish ids. Kept free of DB access so it is
 * trivially unit-testable; the query layer feeds it the raw rows.
 */
export interface AssetObjectIdSources {
  /** Object ids from the authoritative `artifacts` rows for the asset. */
  artifactObjectIds: Array<string | null | undefined>;
  /** Denormalized master manifest object id on the asset. */
  manifestObjectId: string | null | undefined;
  /** Denormalized thumbnail object ids on the asset. */
  thumbnailObjectIds: Array<string | null | undefined>;
  /** Legacy flat list of object ids on the asset (pre-artifact assets). */
  siaObjectIds: Array<string | null | undefined>;
}

export function collectAssetObjectIds(sources: AssetObjectIdSources): string[] {
  const ids = new Set<string>();
  const add = (v: string | null | undefined) => {
    if (v) ids.add(v);
  };

  sources.artifactObjectIds.forEach(add);
  add(sources.manifestObjectId);
  sources.thumbnailObjectIds.forEach(add);
  sources.siaObjectIds.forEach(add);

  return [...ids];
}
