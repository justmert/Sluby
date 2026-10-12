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

/** Below this the library is the Phone board: pills and cards instead of the toolbar and table. */
export const PHONE_QUERY = '(max-width: 639px)';

// the grid has no headers to click, so it keeps a sort menu with every order
// the table's headers can make
export const GRID_SORTS = [
  { value: 'created_at:desc', label: 'Newest first' },
  { value: 'created_at:asc', label: 'Oldest first' },
  { value: 'title:asc', label: 'Title A to Z' },
  { value: 'title:desc', label: 'Title Z to A' },
  { value: 'duration:desc', label: 'Longest first' },
  { value: 'duration:asc', label: 'Shortest first' },
  { value: 'size:desc', label: 'Largest first' },
  { value: 'size:asc', label: 'Smallest first' },
];
