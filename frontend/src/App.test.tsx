import { screen } from '@testing-library/react';
import { useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test/render';
import { WithSession } from '@/test/session';
import { App } from './App';

// each page is a stand-in that names itself, so this tests the route table
// and the redirects, not the pages
vi.mock('@/lib/page-chunks', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/page-chunks')>();
  const page = (name: string) => () =>
    Promise.resolve({ default: () => <p data-testid="page">{name}</p> });
  return {
    ...real,
    PAGE_CHUNKS: Object.fromEntries(Object.keys(real.PAGE_CHUNKS).map((k) => [k, page(k)])),
  };
});

// the shell's own requests (palette, upload store) are not under test here
vi.mock('@/components/layout/AppShell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => (
    <>
      <Where />
      {children}
    </>
  ),
}));

function Where() {
  const { pathname, search, hash } = useLocation();
  return <p data-testid="where">{pathname + search + hash}</p>;
}

const renderAt = (route: string, operator = false) =>
  renderPage(
    <WithSession operator={operator}>
      <App />
    </WithSession>,
    { route },
  );

afterEach(() => vi.restoreAllMocks());

describe('App routes', () => {
  it.each([
    ['/studio', 'overview'],
    ['/studio/videos', 'videos'],
    ['/studio/videos/a1', 'video'],
    // a static segment, so it wins over /studio/videos/:id
    ['/studio/videos/upload', 'upload'],
    ['/studio/developers', 'quickstart'],
    ['/studio/developers/keys', 'apiKeys'],
    ['/studio/developers/webhooks', 'webhooks'],
    ['/studio/developers/webhooks/w1', 'webhook'],
    ['/studio/developers/explorer', 'explorer'],
    ['/studio/settings', 'settings'],
    ['/studio/nope', 'notFound'],
    // nginx and the breadcrumbs match case exactly, so the router does too
    ['/STUDIO', 'notFound'],
    ['/Studio/Videos', 'notFound'],
  ])('serves %s with the %s page', async (route, page) => {
    renderAt(route);
    expect(await screen.findByTestId('page')).toHaveTextContent(page);
    expect(screen.getByTestId('where')).toHaveTextContent(route);
  });

  it('serves the deployment pages to operators', async () => {
    renderAt('/studio/deployment', true);
    expect(await screen.findByTestId('page')).toHaveTextContent('health');
  });

  it('tells a member the deployment pages are for operators', async () => {
    renderAt('/studio/deployment/metrics');
    expect(await screen.findByRole('heading', { name: 'For operators only' })).toBeInTheDocument();
    expect(screen.queryByTestId('page')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to overview' })).toHaveAttribute(
      'href',
      '/studio',
    );
  });

  it.each([
    ['/', '/studio', 'overview'],
    ['/studio/assets?q=Bunny', '/studio/videos?q=Bunny', 'videos'],
    ['/studio/assets/a1?tab=renditions', '/studio/videos/a1?tab=renditions', 'video'],
    ['/studio/upload', '/studio/videos/upload', 'upload'],
    // the old sheet's param, on any page
    ['/studio/videos?view=grid&upload=1', '/studio/videos/upload', 'upload'],
    ['/studio/settings?upload=1', '/studio/videos/upload', 'upload'],
    ['/studio/player', '/studio/videos?status=ready', 'videos'],
    ['/studio/player?asset=f1', '/studio/videos/f1', 'video'],
    ['/studio/developer', '/studio/developers', 'quickstart'],
    ['/studio/developer?create=webhook', '/studio/developers/webhooks?create=webhook', 'webhooks'],
    ['/studio/settings?create=key', '/studio/developers/keys?create=key', 'apiKeys'],
    ['/studio/analytics', '/studio', 'overview'],
  ])('redirects %s to %s', async (from, to, page) => {
    renderAt(from);
    expect(await screen.findByTestId('page')).toHaveTextContent(page);
    expect(screen.getByTestId('where')).toHaveTextContent(to);
  });

  it('sends an operator from analytics to metrics', async () => {
    renderAt('/studio/analytics', true);
    expect(await screen.findByTestId('page')).toHaveTextContent('metrics');
    expect(screen.getByTestId('where')).toHaveTextContent('/studio/deployment/metrics');
  });
});
