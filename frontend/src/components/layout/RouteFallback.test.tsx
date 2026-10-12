import { screen } from '@testing-library/react';
import { act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routeSkeletonWasVisible } from '@/components/dashboard/live';
import { renderPage } from '@/test/render';
import { WithSession } from '@/test/session';
import { HealthLoading } from '@/components/deployment/HealthLoading';
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

afterEach(() => vi.useRealTimers());

describe('RouteFallback', () => {
  it('tells every page it takes over from a skeleton on screen, not only the dashboards', () => {
    vi.useFakeTimers();
    for (const route of ['/studio/videos', '/studio/developers/keys', '/studio/settings']) {
      const { unmount } = renderPage(
        <WithSession>
          <RouteFallback />
        </WithSession>,
        { route },
      );
      act(() => vi.advanceTimersByTime(150));
      expect(routeSkeletonWasVisible()).toBe(true);
      unmount();
    }
  });

  it('says a page is loading', () => {
    renderPage(
      <WithSession>
        <RouteFallback />
      </WithSession>,
      { route: '/studio' },
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading page');
  });

  it('has an h1 while the page loads, as the page skeletons do', () => {
    for (const route of ['/studio', '/studio/videos', '/studio/nope']) {
      const fallback = shapeAt(route);
      const h1 = fallback.querySelectorAll('h1');
      expect(h1).toHaveLength(1);
      expect(h1[0]).toHaveTextContent('Loading page');
      expect(h1[0]).toHaveClass('sr-only');
      fallback.ownerDocument.body.innerHTML = '';
    }
  });

  it('draws the page it is loading, not a generic block', () => {
    // the library is a grid of 8 cards
    expect(shapeAt('/studio/videos').querySelectorAll('.aspect-video')).toHaveLength(8);
  });

  it('draws the dashboard and analytics with the pages own loading pieces', () => {
    // 4 stats, recent videos and status, for members and operators alike (the
    // operator cards live on Health)
    for (const operator of [false, true]) {
      const overview = shapeAt('/studio', operator);
      expect(overview.querySelectorAll('[data-slot="stat-value"]')).toHaveLength(4);
      expect(overview).toHaveTextContent('Recent videos');
      expect(overview).toHaveTextContent('Status');
      expect(overview).not.toHaveTextContent('Sia account');
    }
    // metrics: 8 server stats and the two 224px chart boxes (operators only reach it)
    const metrics = shapeAt('/studio/deployment/metrics', true);
    expect(metrics.querySelectorAll('[data-slot="stat-value"]')).toHaveLength(8);
    expect(metrics.querySelectorAll('[data-slot="skeleton"].h-56')).toHaveLength(2);
  });

  it('has a shape for every page, and none for a path no page serves', () => {
    for (const route of [
      '/studio/videos/a1',
      '/studio/developers',
      '/studio/developers/keys',
      '/studio/developers/webhooks',
      '/studio/developers/webhooks/w1',
      '/studio/developers/explorer',
      '/studio/deployment',
      '/studio/settings',
    ]) {
      expect(shapeAt(route).querySelector('[data-slot="skeleton"]')).not.toBeNull();
    }
    expect(shapeAt('/studio/nope').querySelector('[data-slot="skeleton"]')).toBeNull();
  });

  it('waits before fading in, so a fast load never flashes it', () => {
    expect(shapeAt('/studio/settings')).toHaveClass('delay-150', 'fill-mode-backwards');
  });

  it('draws settings as its one narrow column of three sections, two with sign-in off', () => {
    const on = shapeAt('/studio/settings');
    expect(on.querySelector('[data-slot="page-container"]')).toHaveClass('max-w-320');
    expect(on.querySelectorAll('section[class]')).toHaveLength(3);
    const view = renderPage(
      <WithSession authDisabled>
        <RouteFallback />
      </WithSession>,
      { route: '/studio/settings' },
    );
    expect(
      view.container.querySelectorAll('[data-slot="route-fallback"] section[class]'),
    ).toHaveLength(2);
  });

  it('draws Health with the page’s own first draw, under a header with its status badge', () => {
    const fallback = shapeAt('/studio/deployment', true);
    const { container } = renderPage(
      <WithSession operator>
        <HealthLoading />
      </WithSession>,
    );
    // the same cards with the same text (generated ids differ between renders)
    expect(fallback.textContent).toContain(container.textContent);
    expect(fallback.querySelectorAll('[data-slot="card"]')).toHaveLength(
      container.querySelectorAll('[data-slot="card"]').length,
    );
    expect(container.querySelectorAll('[data-slot="card"]').length).toBeGreaterThan(0);
    expect(fallback.querySelector('.rounded-full.w-44')).not.toBeNull();
  });
});
