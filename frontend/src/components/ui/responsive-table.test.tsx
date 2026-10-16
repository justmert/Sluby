import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TableBody, TableHead, TableHeader, TableRow } from './table';
import { ResponsiveCell, ResponsiveTable } from './responsive-table';

describe('ResponsiveTable', () => {
  it('is a real table whose cells carry their phone labels and roles', () => {
    render(
      <ResponsiveTable aria-label="keys">
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <ResponsiveCell cell="primary">deploy key</ResponsiveCell>
            <ResponsiveCell label="Status">active</ResponsiveCell>
            <ResponsiveCell cell="actions">
              <button type="button">Revoke</button>
            </ResponsiveCell>
          </TableRow>
        </TableBody>
      </ResponsiveTable>,
    );
    const table = screen.getByRole('table', { name: 'keys' });
    expect(table).toHaveAttribute('data-responsive');
    const row = screen.getAllByRole('row')[1];
    const cells = within(row).getAllByRole('cell');
    expect(cells[0]).toHaveAttribute('data-cell', 'primary');
    expect(cells[0]).not.toHaveAttribute('data-label');
    expect(cells[1]).toHaveAttribute('data-label', 'Status');
    expect(cells[2]).toHaveAttribute('data-cell', 'actions');
    expect(within(cells[2]).getByRole('button', { name: 'Revoke' })).toBeInTheDocument();
  });
});
