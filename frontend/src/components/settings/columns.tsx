import type { ColumnFrame } from '@/components/shared/column-frames';

export const SESSION_COLUMNS: readonly ColumnFrame[] = [
  { id: 'browser', header: 'Browser', primary: true },
  { id: 'created', header: 'Signed in' },
  { id: 'seen', header: 'Last active' },
  { id: 'expires', header: 'Expires' },
  { id: 'action', header: <span className="sr-only">Actions</span>, label: '', align: 'right' },
];
