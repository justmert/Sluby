import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderPage } from '@/test/render';
import { RouteFallback } from './RouteFallback';

const shapeAt = (route: string) => {
  const { container } = renderPage(<RouteFallback />, { route });
  return container.querySelector('[data-slot="route-fallback"]')!;
};

describe('RouteFallback', () => {
  it('says a page is loading', () => {
    renderPage(<RouteFallback />, { route: '/studio' });
    expect(screen.getByRole('status')).toHaveTextContent('Loading page');
  });

  it('draws the page it is loading, not a generic block', () => {
    // the library is a grid of 8 cards, the dashboard 4 stats and 2 cards
    expect(shapeAt('/studio/assets').querySelectorAll('.aspect-video')).toHaveLength(8);
    expect(shapeAt('/studio').querySelectorAll('.grid > [data-slot="skeleton"]')).toHaveLength(6);
  });

  it('waits before fading in, so a fast load never flashes it', () => {
    expect(shapeAt('/studio/settings')).toHaveClass('animation-delay-150', 'fill-mode-backwards');
  });
});
