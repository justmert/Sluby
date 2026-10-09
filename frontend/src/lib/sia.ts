import { formatRatio, plural } from './formatters';

// the browser never talks to indexd directly; objects are served by the
// sluby gateway at /v1/objects/:id on the studio's own origin, which handles
// access control, content types, and range requests

/** Same-origin gateway URL for a Sia object. */
export function siaObjectUrl(objectId: string): string {
  const key = objectId.startsWith('/') ? objectId.slice(1) : objectId;
  return `/v1/objects/${key}`;
}

/** Every sector a host stores is 4 MiB; a slab holds one sector per shard. */
export const SECTOR_BYTES = 4 * 1024 * 1024;

/**
 * The plain sentence over the Sia storage tab, built from the numbers:
 * "This video is stored as 9 files on 30 hosts in 6 countries. Sia keeps 3×
 * the data, so the video stays playable if some hosts go offline."
 */
export function storageSummary(totals: {
  object_count: number;
  host_count: number;
  country_count: number;
  redundancy_ratio: number | null;
}): string {
  const where =
    totals.country_count > 0 ? ` in ${plural(totals.country_count, 'country', 'countries')}` : '';
  const stored = `This video is stored as ${plural(totals.object_count, 'file')} on ${plural(totals.host_count, 'host')}${where}.`;
  if (totals.redundancy_ratio === null) return stored;
  return `${stored} Sia keeps ${formatRatio(totals.redundancy_ratio)} the data, so the video stays playable if some hosts go offline.`;
}
