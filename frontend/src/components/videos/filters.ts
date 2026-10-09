import type { AccessTier, VideoAssetStatus } from '@sluby/sdk';
import { STATUS } from '@/components/shared/status';

/** The statuses the api filters by, in the order a person looks for them. */
export const STATUS_FILTERS: { value: VideoAssetStatus; label: string }[] = (
  ['ready', 'processing', 'uploading', 'created', 'failed'] as const
).map((value) => ({ value, label: STATUS.asset[value].label }));

export const ACCESS_FILTERS: { value: AccessTier; label: string }[] = [
  { value: 'public', label: 'Public' },
  { value: 'private', label: 'Private' },
];

/** "no filter" in a select, which cannot hold an empty value */
export const ALL = 'all';

/** Table columns that sort, and the api's sort field for each. */
export const SORT_FIELDS = {
  title: 'title',
  duration: 'duration',
  size: 'size',
  created: 'created_at',
} as const;
export type SortColumn = keyof typeof SORT_FIELDS;
