import type { ColumnFrame } from '@/components/shared/column-frames';

export const KEY_COLUMNS: readonly ColumnFrame[] = [
  { id: 'name', header: 'Name', primary: true, className: 'max-w-64 min-w-36 whitespace-normal' },
  { id: 'key', header: 'Key' },
  // shown from lg: at tablet width the table keeps name, key, last use and status
  { id: 'scopes', header: 'Scopes', className: 'max-lg:hidden!' },
  { id: 'last-used', header: 'Last used', className: 'max-sm:hidden! whitespace-nowrap' },
  {
    id: 'created',
    header: 'Created',
    className: 'max-xl:hidden! whitespace-nowrap text-muted-foreground',
  },
  { id: 'status', header: 'Status', className: 'whitespace-nowrap' },
];

export const WEBHOOK_COLUMNS: readonly ColumnFrame[] = [
  {
    id: 'url',
    header: 'Endpoint URL',
    primary: true,
    className: 'max-w-96 min-w-48 whitespace-normal',
  },
  { id: 'events', header: 'Events', className: 'whitespace-nowrap' },
  { id: 'last', header: 'Last delivery' },
  { id: 'status', header: 'Status' },
];
