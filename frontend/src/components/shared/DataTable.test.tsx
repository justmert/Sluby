import { useState } from 'react';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Trash2, ArrowUpRight } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { renderWithMotion } from '@/test/render';
import { DataTable, type DataTableColumn, type SortState } from './DataTable';

interface Row {
  id: string;
  name: string;
  size: number;
}

const columns: DataTableColumn<Row>[] = [
  { id: 'name', header: 'Name', primary: true, cell: (r) => r.name, sortable: true },
  { id: 'size', header: 'Size', align: 'right', cell: (r) => `${r.size} MB`, sortable: true },
];

const rows: Row[] = [
  { id: 'a', name: 'Alpha', size: 3 },
  { id: 'b', name: 'Beta', size: 9 },
];

function Harness({
  onSort,
  onOpen,
  onDelete,
}: {
  onSort?: (s: SortState) => void;
  onOpen?: () => void;
  onDelete?: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortState>({ column: 'name', direction: 'asc' });
  return (
    <DataTable
      caption="Videos"
      columns={columns}
      rows={rows}
      getRowId={(r) => r.id}
      getRowLabel={(r) => r.name}
      sort={sort}
      onSortChange={(s) => {
        setSort(s);
        onSort?.(s);
      }}
      selected={selected}
      onSelectedChange={setSelected}
      rowActions={() => [
        { label: 'Open', icon: ArrowUpRight, onSelect: onOpen ?? (() => {}) },
        { label: 'Delete', icon: Trash2, onSelect: onDelete ?? (() => {}), destructive: true },
      ]}
      toolbar={<input aria-label="Search videos" />}
    />
  );
}

describe('DataTable', () => {
  it('renders a named table with the toolbar', () => {
    renderWithMotion(<Harness />);
    expect(screen.getByRole('table', { name: 'Videos' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Search videos' })).toBeInTheDocument();
  });

  it('reports sorting and marks the sorted column', async () => {
    const onSort = vi.fn();
    renderWithMotion(<Harness onSort={onSort} />);
    expect(screen.getByRole('columnheader', { name: /Name/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    await userEvent.click(screen.getByRole('button', { name: /Size/ }));
    // numbers sort biggest first on the first click
    expect(onSort).toHaveBeenLastCalledWith({ column: 'size', direction: 'desc' });
    await userEvent.click(screen.getByRole('button', { name: /Size/ }));
    expect(onSort).toHaveBeenLastCalledWith({ column: 'size', direction: 'asc' });
  });

  it('selects rows one by one and all at once', async () => {
    renderWithMotion(<Harness />);
    const all = screen.getByRole('checkbox', { name: 'Select all on this page' });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Alpha' }));
    expect(all).toHaveAttribute('data-state', 'indeterminate');
    expect(screen.getByText('Alpha').closest('tr')).toHaveAttribute('data-state', 'selected');
    await userEvent.click(all);
    expect(all).toHaveAttribute('data-state', 'checked');
    await userEvent.click(all);
    expect(all).toHaveAttribute('data-state', 'unchecked');
  });

  it('puts the row actions in a menu with the destructive one last', async () => {
    const onDelete = vi.fn();
    renderWithMotion(<Harness onDelete={onDelete} />);
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Beta' }));
    const items = screen.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Open', 'Delete']);
    await userEvent.click(items[1]);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('shows skeleton rows while loading, an empty state, and an error with retry', async () => {
    const retry = vi.fn();
    const { rerender, container } = renderWithMotion(
      <DataTable
        caption="Keys"
        columns={columns}
        rows={undefined}
        getRowId={(r) => r.id}
        getRowLabel={(r) => r.name}
      />,
    );
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('[data-slot=skeleton]').length).toBeGreaterThan(0);

    rerender(
      <DataTable
        caption="Keys"
        columns={columns}
        rows={[]}
        getRowId={(r) => r.id}
        getRowLabel={(r) => r.name}
        empty={<p>No API keys yet</p>}
      />,
    );
    expect(screen.getByText('No API keys yet')).toBeInTheDocument();

    rerender(
      <DataTable
        caption="Keys"
        columns={columns}
        rows={undefined}
        getRowId={(r) => r.id}
        getRowLabel={(r) => r.name}
        error={new ApiError(503, 'HTTP 503')}
        what="your API keys"
        onRetry={retry}
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Could not load your API keys');
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('labels cells for the phone layout', () => {
    renderWithMotion(<Harness />);
    const cell = screen.getByText('3 MB').closest('td')!;
    expect(cell).toHaveAttribute('data-label', 'Size');
    expect(screen.getByText('Alpha').closest('td')).toHaveAttribute('data-cell', 'primary');
  });
});
