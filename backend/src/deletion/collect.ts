/**
 * Every Sia object id an asset references, from each place one is recorded,
 * deduplicated and without empty values. The query layer passes the rows in.
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
