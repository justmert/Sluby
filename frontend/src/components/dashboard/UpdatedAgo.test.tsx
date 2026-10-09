import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { UpdatedAgo } from './UpdatedAgo';

const dot = () => document.querySelector('[data-slot="updated-dot"]') as HTMLElement;

describe('UpdatedAgo', () => {
  it('pops the dot only when the figures change, not on every refetch', () => {
    const first = { total: 1 };
    const { rerender } = render(<UpdatedAgo updatedAt={1000} data={first} label="Totals updated" />);
    expect(dot()).not.toHaveClass('animate-in');

    // a poll that brought the same figures: react query keeps the same object
    rerender(<UpdatedAgo updatedAt={2000} data={first} label="Totals updated" />);
    expect(dot()).not.toHaveClass('animate-in');

    rerender(<UpdatedAgo updatedAt={3000} data={{ total: 2 }} label="Totals updated" />);
    expect(dot()).toHaveClass('animate-in', 'duration-300', 'transition-none');
  });

  it('says how long ago in words and when the refresh failed', () => {
    render(<UpdatedAgo updatedAt={Date.now() - 12_000} data={{}} stale label="Totals updated" />);
    expect(screen.getByText('Totals updated 12 seconds ago, could not refresh')).toBeInTheDocument();
  });

  it('holds its line before the first answer', () => {
    const { container } = render(<UpdatedAgo updatedAt={0} />);
    expect(container.querySelector('p')).toHaveClass('h-4');
  });
});
