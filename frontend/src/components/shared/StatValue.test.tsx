import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { renderWithMotion } from '@/test/render';
import { StatValue } from './StatValue';

describe('StatValue', () => {
  it('shows a skeleton of the number height while loading', () => {
    const { container } = renderWithMotion(<StatValue value={undefined} />);
    const skeleton = container.querySelector('[data-slot="stat-value"]');
    expect(skeleton).toHaveClass('h-8');
  });

  it('shows the formatted value at stat size with tabular digits', () => {
    renderWithMotion(<StatValue value={2048} format={(n) => `${Math.round(n)} B`} />);
    const readable = screen.getByText('2048 B', { ignore: '[aria-hidden="true"]' });
    const box = readable.parentElement;
    expect(box).toHaveClass('text-2xl', 'leading-8', 'tabular-nums');
  });
});

describe('CardTitle in a small card', () => {
  it('lets a page size win over the small card size', () => {
    renderWithMotion(
      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-2xl">42</CardTitle>
          <CardTitle>Plain</CardTitle>
        </CardHeader>
      </Card>,
    );
    const sized = screen.getByText('42');
    expect(sized).toHaveClass('text-2xl');
    // no size class or variant is left that could outrank text-2xl
    expect(sized.className).not.toMatch(/text-\(length|group-data-\[size=sm\]/);
    // without a page size the title still reads the card's size variable
    expect(screen.getByText('Plain')).toHaveClass('text-(length:--card-title-size)');
  });
});
