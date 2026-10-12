import { useState } from 'react';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { VideoAsset } from '@sluby/sdk';
import type { SortState } from '@/components/shared/DataTable';
import { renderPage } from '@/test/render';
import { video } from './test-assets';
import { videoActions } from './video-actions';
import { VideosTable } from './VideosTable';

function Harness({
  assets,
  onSort,
  footer,
}: {
  assets: VideoAsset[];
  onSort?: (s: SortState) => void;
  footer?: React.ReactNode;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  return (
    <VideosTable
      assets={assets}
      sort={{ column: 'created', direction: 'desc' }}
      onSortChange={onSort ?? (() => {})}
      selected={selected}
      onSelectedChange={setSelected}
      actions={(a) => videoActions(a, { open: vi.fn(), preview: vi.fn(), delete: vi.fn() })}
      staggerIn={false}
      busy={false}
      rowsKey="k"
      footer={footer}
    />
  );
}

const cellUnder = (row: HTMLElement, header: string) => {
  const th = screen.getByRole('columnheader', { name: new RegExp(`^${header}`) });
  const index = [...th.parentElement!.children].indexOf(th);
  return row.children[index];
};

describe('VideosTable', () => {
  it('has the board columns in order, and scrolls sideways in its card when narrow', () => {
    renderPage(<Harness assets={[video('a1', 'Walkthrough')]} />);
    const table = screen.getByRole('table', { name: 'Videos' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['', 'Video', 'Status', 'Access', 'Length', 'Plays', 'Size', 'Uploaded', 'Actions']);
    expect(table).toHaveClass('min-w-220');
    expect(table.parentElement).toHaveClass('overflow-x-auto');
  });

  it('shows each fact in its column, with an en dash for a missing one', () => {
    renderPage(
      <Harness
        assets={[
          video('a1aaaaaaaa', 'Walkthrough', { playCount: 128 }),
          video('p1', 'Secret', { accessTier: 'private', durationMs: null, totalStorageBytes: 0 }),
        ]}
      />,
    );
    const row = screen.getByRole('link', { name: 'Walkthrough' }).closest('tr')!;
    expect(cellUnder(row, 'Length')).toHaveTextContent('1:30');
    expect(cellUnder(row, 'Size')).toHaveTextContent('3.1 MB');
    expect(cellUnder(row, 'Plays')).toHaveTextContent(/^128$/);
    expect(cellUnder(row, 'Uploaded')).toHaveTextContent('2 hours ago');
    expect(cellUnder(row, 'Access')).toHaveTextContent('Public');
    expect(cellUnder(row, 'Status')).toHaveTextContent('Ready');
    // the short id under the title
    expect(within(row).getByText('a1aaaaaa')).toHaveClass('font-mono');
    const secret = screen.getByRole('link', { name: 'Secret' }).closest('tr')!;
    expect(cellUnder(secret, 'Length')).toHaveTextContent(/^–$/);
    expect(cellUnder(secret, 'Size')).toHaveTextContent(/^–$/);
    expect(cellUnder(secret, 'Access')).toHaveTextContent('Private');
  });

  it('shows the plays the server counted, zero included, and none for a video not ready', () => {
    renderPage(
      <Harness
        assets={[
          video('a1', 'Walkthrough', { playCount: 0 }),
          video('b1', 'Broken', { status: 'failed' }),
        ]}
      />,
    );
    const row = screen.getByRole('link', { name: 'Walkthrough' }).closest('tr')!;
    expect(cellUnder(row, 'Plays')).toHaveTextContent(/^0$/);
    const broken = screen.getByRole('link', { name: 'Broken' }).closest('tr')!;
    expect(cellUnder(broken, 'Plays')).toHaveTextContent(/^–$/);
  });

  it('sorts title, length, size and uploaded, with the arrow on the active one only', async () => {
    const onSort = vi.fn();
    renderPage(<Harness assets={[video('a1', 'Walkthrough')]} onSort={onSort} />);
    for (const name of ['Video', 'Length', 'Size', 'Uploaded']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    for (const name of ['Status', 'Access', 'Plays']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    const uploaded = screen.getByRole('columnheader', { name: 'Uploaded' });
    expect(uploaded).toHaveAttribute('aria-sort', 'descending');
    expect(uploaded.querySelector('svg')).not.toBeNull();
    expect(screen.getByRole('columnheader', { name: 'Length' }).querySelector('svg')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Length' }));
    expect(onSort).toHaveBeenCalledWith({ column: 'duration', direction: 'desc' });
    await userEvent.click(screen.getByRole('button', { name: 'Uploaded' }));
    expect(onSort).toHaveBeenLastCalledWith({ column: 'created', direction: 'asc' });
    await userEvent.click(screen.getByRole('button', { name: 'Video' }));
    expect(onSort).toHaveBeenLastCalledWith({ column: 'title', direction: 'asc' });
  });

  it('gives a selected row the neutral fill and selects ranges with shift', async () => {
    renderPage(<Harness assets={[video('a1', 'One'), video('a2', 'Two'), video('a3', 'Three')]} />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select One' }));
    const row = screen.getByRole('link', { name: 'One' }).closest('tr')!;
    expect(row).toHaveAttribute('data-state', 'selected');
    expect(row).toHaveClass('bg-muted');
    const user = userEvent.setup();
    await user.keyboard('{Shift>}');
    await user.click(screen.getByRole('checkbox', { name: 'Select Three' }));
    await user.keyboard('{/Shift}');
    expect(screen.getByRole('checkbox', { name: 'Select Two' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select all on this page' })).toBeChecked();
  });

  it('marks an upload that stopped and names the row menu for its video', () => {
    renderPage(
      <Harness
        assets={[
          video('s1', 'Stalled', { status: 'created', createdAt: '2026-10-01T00:00:00Z' }),
          video('a1', 'Walkthrough'),
        ]}
      />,
    );
    expect(screen.getByText('Upload interrupted')).toBeInTheDocument();
    expect(screen.getAllByText('Interrupted').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Actions for Walkthrough' })).toBeInTheDocument();
  });

  it('puts the pager inside its card, under the rows', () => {
    renderPage(
      <Harness assets={[video('a1', 'Walkthrough')]} footer={<nav aria-label="Pages">p</nav>} />,
    );
    const table = screen.getByRole('table', { name: 'Videos' });
    const card = table.closest('.rounded-xl')!;
    expect(card).toContainElement(screen.getByRole('navigation', { name: 'Pages' }));
  });
});
