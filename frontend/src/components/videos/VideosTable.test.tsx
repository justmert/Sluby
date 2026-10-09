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

function Harness({ assets, onSort }: { assets: VideoAsset[]; onSort?: (s: SortState) => void }) {
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
    />
  );
}

describe('VideosTable', () => {
  it('shows each fact in its column and sizes the columns for a fixed layout', () => {
    renderPage(
      <Harness
        assets={[
          video('a1', 'Walkthrough', { playCount: 128 } as Partial<VideoAsset>),
          video('p1', 'Secret', { accessTier: 'private', durationMs: null, totalStorageBytes: 0 }),
        ]}
      />,
    );
    const table = screen.getByRole('table', { name: 'Videos' });
    expect(table).toHaveClass('table-fixed');
    const row = within(table).getByRole('link', { name: 'Walkthrough' }).closest('tr')!;
    expect(row).toHaveTextContent('1:30');
    expect(row).toHaveTextContent('3.1 MB');
    expect(row).toHaveTextContent('128');
    expect(row).toHaveTextContent('2 hours ago');
    expect(row).toHaveTextContent('Public');
    // an empty value is an en dash, never a hyphen or a 0
    const secret = within(table).getByRole('link', { name: 'Secret' }).closest('tr')!;
    expect(secret.querySelectorAll('td')[4]).toHaveTextContent('–');
    expect(within(secret).getAllByText('Private').length).toBeGreaterThan(0);
  });

  it('shows an en dash for plays until the server counts them', () => {
    renderPage(<Harness assets={[video('a1', 'Walkthrough')]} />);
    const plays = screen.getByRole('columnheader', { name: 'Plays' });
    const index = [...plays.parentElement!.children].indexOf(plays);
    const cell = screen.getByRole('link', { name: 'Walkthrough' }).closest('tr')!.children[index];
    expect(cell).toHaveTextContent('–');
  });

  it('drops columns by its own width and leaves facts the cards repeat out of them', () => {
    renderPage(<Harness assets={[video('a1', 'Walkthrough')]} />);
    expect(screen.getByRole('columnheader', { name: 'Plays' })).toHaveClass(
      '@5xl/table:table-cell',
    );
    expect(screen.getByRole('columnheader', { name: /Size/ })).toHaveClass('@5xl/table:table-cell');
    expect(screen.getByRole('columnheader', { name: /Duration/ })).toHaveClass(
      '@3xl/table:table-cell',
    );
    expect(screen.getByRole('columnheader', { name: /Created/ })).toHaveClass(
      '@3xl/table:table-cell',
    );
    const header = screen.getByRole('columnheader', { name: 'Status' });
    const index = [...header.parentElement!.children].indexOf(header);
    const cell = screen.getByRole('link', { name: 'Walkthrough' }).closest('tr')!.children[index];
    expect(cell).toHaveAttribute('data-card-hidden', 'true');
  });

  it('sorts title, duration, size and created, not status, access or plays', async () => {
    const onSort = vi.fn();
    renderPage(<Harness assets={[video('a1', 'Walkthrough')]} onSort={onSort} />);
    for (const name of ['Video', 'Duration', 'Size', 'Created']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${name}`) })).toBeInTheDocument();
    }
    for (const name of ['Status', 'Access', 'Plays']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
    await userEvent.click(screen.getByRole('button', { name: /^Duration/ }));
    expect(onSort).toHaveBeenCalledWith({ column: 'duration', direction: 'desc' });
    await userEvent.click(screen.getByRole('button', { name: /^Created/ }));
    expect(onSort).toHaveBeenLastCalledWith({ column: 'created', direction: 'asc' });
  });

  it('marks an upload that stopped, and names the copy button for its video', () => {
    renderPage(
      <Harness
        assets={[
          video('s1', 'Stalled', { status: 'created', createdAt: '2026-10-01T00:00:00Z' }),
          video('a1', 'Walkthrough'),
        ]}
      />,
    );
    expect(screen.getByText('Upload interrupted')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Copy video ID of Walkthrough' }),
    ).toBeInTheDocument();
  });

  it('gives every row a scroll margin under the sticky toolbar (A11Y-23)', () => {
    renderPage(<Harness assets={[video('a1', 'Walkthrough')]} />);
    expect(screen.getByRole('link', { name: 'Walkthrough' }).closest('tr')).toHaveClass(
      'scroll-mt-36',
    );
  });
});
