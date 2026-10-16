import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithMotion } from '@/test/render';
import { FilterPopover } from './FilterPopover';

describe('FilterPopover', () => {
  it('sets status and access from one menu and counts what is on', async () => {
    const onStatus = vi.fn();
    const onTier = vi.fn();
    const { rerender } = renderWithMotion(
      <FilterPopover
        status={undefined}
        tier={undefined}
        onStatusChange={onStatus}
        onTierChange={onTier}
      />,
    );
    expect(screen.getByRole('button', { name: 'Filter' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Filter' }));
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Waiting for file' }));
    expect(onStatus).toHaveBeenCalledWith('created');

    rerender(
      <FilterPopover
        status="failed"
        tier="private"
        onStatusChange={onStatus}
        onTierChange={onTier}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Filter, 2 on' }));
    expect(await screen.findByRole('menuitemradio', { name: 'Failed' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'All access' }));
    expect(onTier).toHaveBeenCalledWith(undefined);
  });

  it('clears every filter from the menu when one is on', async () => {
    const onClear = vi.fn();
    renderWithMotion(
      <FilterPopover
        status="failed"
        tier={undefined}
        onStatusChange={vi.fn()}
        onTierChange={vi.fn()}
        onClear={onClear}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Filter, 1 on' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Clear filters' }));
    expect(onClear).toHaveBeenCalled();
  });
});
