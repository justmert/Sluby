/** Orders the asset listing supports, shared by the route and the query. */
export const ASSET_SORT_FIELDS = ['created_at', 'title', 'duration', 'size'] as const;
export type AssetSortField = (typeof ASSET_SORT_FIELDS)[number];
export type SortOrder = 'asc' | 'desc';

/** True when the list uses the keyset order a cursor encodes (newest first). */
export function isDefaultAssetOrder(sort?: AssetSortField, order?: SortOrder): boolean {
  return (sort ?? 'created_at') === 'created_at' && (order ?? 'desc') === 'desc';
}
