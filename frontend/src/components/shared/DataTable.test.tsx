import { useState } from 'react';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Trash2, ArrowUpRight } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-client';
import { renderWithMotion } from '@/test/render';
import { DataTable, type DataTableColumn, type SortState } from './DataTable';
import { selectRange } from './select-range';

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

  it('selects a range on shift-click, from the last row toggled', async () => {
    const many: Row[] = Array.from({ length: 6 }, (_, i) => ({
      id: `r${i}`,
      name: `Row ${i}`,
      size: i,
    }));
    function Range() {
      const [selected, setSelected] = useState<Set<string>>(new Set());
      return (
        <DataTable
          caption="Rows"
          columns={columns}
          rows={many}
          getRowId={(r) => r.id}
          getRowLabel={(r) => r.name}
          selected={selected}
          onSelectedChange={setSelected}
        />
      );
    }
    const user = userEvent.setup();
    renderWithMotion(<Range />);
    const box = (n: number) => screen.getByRole('checkbox', { name: `Select Row ${n}` });
    await user.click(box(1));
    await user.keyboard('{Shift>}');
    await user.click(box(4));
    await user.keyboard('{/Shift}');
    expect([0, 1, 2, 3, 4, 5].map((n) => box(n).getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'true',
      'true',
      'true',
      'false',
    ]);
    // a shift-click that clears takes the range from the anchor with it
    await user.keyboard('{Shift>}');
    await user.click(box(2));
    await user.keyboard('{/Shift}');
    expect([0, 1, 2, 3, 4, 5].map((n) => box(n).getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
      'false',
      'false',
      'false',
    ]);
  });

  it('computes ranges in either direction and without an anchor', () => {
    const ids = ['a', 'b', 'c', 'd'];
    expect([...selectRange(ids, new Set(), 'c', 'a', true)].sort()).toEqual(['a', 'b', 'c']);
    expect([...selectRange(ids, new Set(['a', 'b', 'c']), 'a', 'b', false)].sort()).toEqual(['c']);
    expect([...selectRange(ids, new Set(), null, 'd', true)]).toEqual(['d']);
    expect([...selectRange(ids, new Set(), 'gone', 'b', true)]).toEqual(['b']);
  });

  it('switches to cards by its own width and hides columns by breakpoint', () => {
    renderWithMotion(
      <DataTable
        caption="Videos"
        layout="fixed"
        columns={[
          { id: 'name', header: 'Name', primary: true, cell: (r: Row) => r.name },
          {
            id: 'size',
            header: 'Size',
            width: 'w-24',
            hideBelow: '3xl',
            hideInCards: true,
            cell: (r: Row) => r.size,
          },
        ]}
        rows={rows}
        getRowId={(r) => r.id}
        getRowLabel={(r) => r.name}
      />,
    );
    const table = screen.getByRole('table', { name: 'Videos' });
    expect(table).toHaveAttribute('data-responsive', 'container');
    expect(table).toHaveClass('table-fixed');
    expect(table.closest('.\\@container\\/table')).not.toBeNull();
    const header = screen.getByRole('columnheader', { name: 'Size' });
    expect(header).toHaveClass('w-24', 'hidden', '@3xl/table:table-cell');
    const cell = screen.getByText('3').closest('td')!;
    expect(cell).toHaveAttribute('data-card-hidden', 'true');
    expect(cell).toHaveClass('hidden', '@3xl/table:table-cell');
  });

  it('names its headers with plain words while it is cards, so none is empty', () => {
    const Original = window.ResizeObserver;
    // a table 300px wide: cards
    window.ResizeObserver = class {
      constructor(private cb: ResizeObserverCallback) {}
      observe() {
        this.cb([{ contentRect: { width: 300 } } as ResizeObserverEntry], this as never);
      }
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    try {
      renderWithMotion(<Harness />);
      const headers = screen.getAllByRole('columnheader');
      expect(headers[0]).toHaveTextContent('Select');
      expect(screen.queryByRole('checkbox', { name: 'Select all on this page' })).toBeNull();
      expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Name/ })).toBeNull();
    } finally {
      window.ResizeObserver = Original;
    }
  });

  it('animates rows in and out when asked, keeping a row in place across an id change', async () => {
    const { rerender } = renderWithMotion(
      <DataTable
        caption="Playback IDs"
        columns={columns}
        rows={[{ id: 'pending:1', name: 'New', size: 1 }, ...rows]}
        getRowId={(r) => r.id}
        getRowKey={(r) => (r.id === 'real' ? 'pending:1' : r.id)}
        getRowLabel={(r) => r.name}
        animateRows
      />,
    );
    const table = screen.getByRole('table', { name: 'Playback IDs' });
    const before = within(table).getByText('New').closest('tr')!;
    expect(before).toHaveAttribute('data-slot', 'table-row');
    rerender(
      <DataTable
        caption="Playback IDs"
        columns={columns}
        rows={[{ id: 'real', name: 'New', size: 1 }, rows[1]]}
        getRowId={(r) => r.id}
        getRowKey={(r) => (r.id === 'real' ? 'pending:1' : r.id)}
        getRowLabel={(r) => r.name}
        animateRows
      />,
    );
    // the placeholder became the real row without leaving and entering again
    expect(within(table).getByText('New').closest('tr')).toBe(before);
    await vi.waitFor(() => expect(within(table).queryByText('Alpha')).toBeNull());
    expect(within(table).getAllByRole('row')).toHaveLength(3);
  });
  it('fades in a row added later, but not the rows of the first render', async () => {
    const { rerender, container } = renderWithMotion(
      <DataTable
        caption="Keys"
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
        getRowLabel={(r) => r.name}
        animateRows
      />,
    );
    const first = screen.getByText('Alpha').closest('tr')!;
    // first render starts at the visible state, with no fade
    expect(first.style.opacity).toBe('1');
    rerender(
      <DataTable
        caption="Keys"
        columns={columns}
        rows={[{ id: 'c', name: 'Gamma', size: 1 }, ...rows]}
        getRowId={(r) => r.id}
        getRowLabel={(r) => r.name}
        animateRows
      />,
    );
    const added = screen.getByText('Gamma').closest('tr')!;
    // the new row starts from listItem's hidden state
    expect(added.style.opacity).toBe('0');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(3);
  });
});
