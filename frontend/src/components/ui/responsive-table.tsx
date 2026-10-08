import * as React from 'react';
import { Table, TableCell } from '@/components/ui/table';

/**
 * A Table that turns each row into a small card below `sm` (640px): the
 * header row goes visually hidden (still read by screen readers), every cell
 * stacks under the one before with its column name in front, and the actions
 * cell pins to the top right so Rotate, Delete or a menu stay on screen. At
 * `sm` and up it is a plain table. The layout lives in index.css under
 * table[data-responsive].
 *
 *   <ResponsiveTable>
 *     <TableHeader>…same as a Table…</TableHeader>
 *     <TableBody>
 *       {keys.map((k) => (
 *         <TableRow key={k.id}>
 *           <ResponsiveCell cell="primary">{k.name}</ResponsiveCell>
 *           <ResponsiveCell label="Scopes">{k.scopes.join(', ')}</ResponsiveCell>
 *           <ResponsiveCell label="Status"><StatusBadge … /></ResponsiveCell>
 *           <ResponsiveCell cell="actions"><KeyMenu … /></ResponsiveCell>
 *         </TableRow>
 *       ))}
 *     </TableBody>
 *   </ResponsiveTable>
 */
function ResponsiveTable(props: React.ComponentProps<typeof Table>) {
  return <Table data-responsive="" {...props} />;
}

interface ResponsiveCellProps extends React.ComponentProps<typeof TableCell> {
  /** the column name shown in front of the value on phones; leave it off for primary and actions */
  label?: string;
  /** "primary" is the row's title on phones; "actions" pins to the top right and "select" (a row checkbox) under it */
  cell?: 'primary' | 'actions' | 'select';
}

function ResponsiveCell({ label, cell, ...props }: ResponsiveCellProps) {
  return <TableCell data-label={label} data-cell={cell} {...props} />;
}

export { ResponsiveTable, ResponsiveCell };
