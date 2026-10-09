import type { ReactNode } from 'react';
import type { DataTableColumn } from './DataTable';

/**
 * A table's columns without their cells. The page adds the cells, and the
 * route skeleton draws the same table from the frames while the page's code
 * loads, so the rows land in the boxes people already see.
 */
export type ColumnFrame = Omit<DataTableColumn<never>, 'cell'>;

/** The frames with each column's cell, by column id. */
export function withCells<T>(
  frames: readonly ColumnFrame[],
  cells: Record<string, (row: T) => ReactNode>,
): DataTableColumn<T>[] {
  return frames.map((f) => ({ ...f, cell: cells[f.id] }));
}
