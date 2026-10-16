import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderPage } from '@/test/render';
import { WithSession } from '@/test/session';
import { RouteFallback } from './RouteFallback';

const shapeAt = (route: string, operator = false) => {
  const { container } = renderPage(
    <WithSession operator={operator}>
      <RouteFallback />
    </WithSession>,
    { route },
  );
  return container.querySelector('[data-slot="route-fallback"]')!;
};

describe('RouteFallback', () => {
  it('says a page is loading', () => {
    renderPage(
      <WithSession>
        <RouteFallback />
      </WithSession>,
      { route: '/studio' },
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading page');
  });

  it('draws the page it is loading, not a generic block', () => {
    // the library is a grid of 8 cards
    expect(shapeAt('/studio/assets').querySelectorAll('.aspect-video')).toHaveLength(8);
  });

  it('draws the dashboard and analytics with the pages own loading pieces', () => {
    // 4 library stats, latest uploads and status; operators also get the deployment cards
    const tenant = shapeAt('/studio');
    expect(tenant.querySelectorAll('[data-slot="stat-value"]')).toHaveLength(4);
    expect(tenant).toHaveTextContent('Latest uploads');
    expect(tenant).toHaveTextContent('Service status');
    expect(tenant).not.toHaveTextContent('Storage usage');
    const operator = shapeAt('/studio', true);
    expect(operator).toHaveTextContent('Storage usage');
    expect(operator).toHaveTextContent('Reconciliation');
    // analytics: 8 server stats and the two 224px chart boxes for operators, the library for all
    const analytics = shapeAt('/studio/analytics', true);
    expect(analytics.querySelectorAll('[data-slot="stat-value"]')).toHaveLength(8);
    expect(analytics.querySelectorAll('[data-slot="skeleton"].h-56')).toHaveLength(2);
    expect(analytics.querySelectorAll('[data-slot="skeleton"].h-48')).toHaveLength(1);
    const tenantAnalytics = shapeAt('/studio/analytics');
    expect(tenantAnalytics).toHaveTextContent('Server metrics are for operators');
    expect(tenantAnalytics.querySelectorAll('[data-slot="stat-value"]')).toHaveLength(0);
  });

  it('waits before fading in, so a fast load never flashes it', () => {
    expect(shapeAt('/studio/settings')).toHaveClass('animation-delay-150', 'fill-mode-backwards');
  });
});
