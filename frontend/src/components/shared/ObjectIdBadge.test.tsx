import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithMotion } from '@/test/render';
import { ObjectIdBadge } from './ObjectIdBadge';

describe('ObjectIdBadge', () => {
  it('stays inside its box at a large text size, so the copy button is never cut off (1.4.4)', () => {
    renderWithMotion(
      <ObjectIdBadge value={'ab'.repeat(32)} copyLabel="Copy main playlist file ID" />,
    );
    const badge = screen.getByTitle('ab'.repeat(32));
    expect(badge).toHaveClass('max-w-full');
    expect(badge.firstElementChild).toHaveClass('truncate');
    expect(screen.getByRole('button', { name: 'Copy main playlist file ID' })).toBeInTheDocument();
  });
});
