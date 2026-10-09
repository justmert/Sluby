import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithMotion } from '@/test/render';
import { BulkBar, type BulkBarProps } from './BulkBar';

const props = (over: Partial<BulkBarProps> = {}): BulkBarProps => ({
  count: 3,
  onPage: 24,
  total: 70,
  acrossPages: false,
  selectingAll: false,
  cap: 500,
  changing: null,
  onSelectAll: vi.fn(),
  onMakePublic: vi.fn(),
  onMakePrivate: vi.fn(),
  onDelete: vi.fn(),
  onClear: vi.fn(),
  ...over,
});

describe('BulkBar', () => {
  it('counts the selection and runs each action', async () => {
    const p = props();
    renderWithMotion(<BulkBar {...p} />);
    const bar = screen.getByRole('toolbar', { name: 'Selected videos' });
    expect(bar).toHaveTextContent('3 of 24 selected');
    for (const [name, fn] of [
      ['Make public', p.onMakePublic],
      ['Make private', p.onMakePrivate],
      ['Delete', p.onDelete],
      ['Clear', p.onClear],
    ] as const) {
      await userEvent.click(screen.getByRole('button', { name }));
      expect(fn).toHaveBeenCalledTimes(1);
    }
    expect(screen.queryByText(/on this page are selected/)).not.toBeInTheDocument();
  });

  it('shortens the count on the narrowest screens (A11Y-25)', () => {
    renderWithMotion(<BulkBar {...props()} />);
    expect(screen.getByText('of 24', { exact: false })).toHaveClass('max-[359px]:hidden');
  });

  it('offers every result once the whole page is selected (FLW-43)', async () => {
    const p = props({ count: 24 });
    renderWithMotion(<BulkBar {...p} />);
    expect(screen.getByText('All 24 on this page are selected.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Select all 70 results' }));
    expect(p.onSelectAll).toHaveBeenCalled();
  });

  it('says when the cap cuts the selection short', () => {
    const { rerender } = renderWithMotion(<BulkBar {...props({ count: 24, total: 900 })} />);
    expect(
      screen.getByRole('button', { name: 'Select the first 500 results' }),
    ).toBeInTheDocument();
    rerender(<BulkBar {...props({ count: 500, total: 900, acrossPages: true })} />);
    expect(screen.getByText('The first 500 of 900 results are selected.')).toBeInTheDocument();
    expect(screen.getByRole('toolbar')).toHaveTextContent(/500 selected/);
    expect(screen.getByRole('toolbar')).not.toHaveTextContent(/of 24/);
  });

  it('turns the actions off while an access change runs', () => {
    renderWithMotion(<BulkBar {...props({ changing: 'private' })} />);
    expect(screen.getByRole('button', { name: 'Make private' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeEnabled();
  });

  it('lifts the toasts while it shows and drops the lift when it goes', () => {
    const { unmount } = renderWithMotion(<BulkBar {...props()} />);
    expect(document.documentElement.style.getPropertyValue('--toast-lift')).toBe('4rem');
    unmount();
    expect(document.documentElement.style.getPropertyValue('--toast-lift')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--bulk-bar-pad')).toBe('');
  });

  it('gives the page its height as a variable, so a toast can ask for more room (A11Y-25)', () => {
    renderWithMotion(<BulkBar {...props()} />);
    const root = document.documentElement;
    // no inline padding, which would win over the toast rule in the stylesheet
    expect(root.style.scrollPaddingBottom).toBe('');
    expect(root.style.getPropertyValue('--bulk-bar-pad')).toMatch(/^\d+px$/);
  });
});
