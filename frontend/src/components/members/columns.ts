import type { ColumnFrame } from '@/components/shared/column-frames';

export const MEMBER_COLUMNS: readonly ColumnFrame[] = [
  { id: 'name', header: 'Name', primary: true, className: 'max-w-56 min-w-32 whitespace-normal' },
  {
    id: 'sign-in',
    header: 'Signs in with',
    label: 'Signs in with',
    // how someone signs in is what tells two members apart, so phones keep it
    className: 'max-w-72 min-w-40 whitespace-normal',
  },
  { id: 'role', header: 'Role', className: 'whitespace-nowrap' },
  { id: 'status', header: 'Status', className: 'whitespace-nowrap' },
  {
    id: 'last-sign-in',
    header: 'Last sign-in',
    className: 'max-lg:hidden! whitespace-nowrap text-muted-foreground',
  },
];

export const INVITE_COLUMNS: readonly ColumnFrame[] = [
  { id: 'role', header: 'Role', primary: true, className: 'whitespace-nowrap' },
  { id: 'created-by', header: 'Created by', className: 'whitespace-normal' },
  { id: 'created', header: 'Created', className: 'max-sm:hidden! whitespace-nowrap' },
  { id: 'expires', header: 'Expires', className: 'whitespace-nowrap' },
];
