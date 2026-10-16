import { lazy, Suspense } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reloadPage } from '@/lib/navigation';
import { ErrorBoundary } from './ErrorBoundary';

vi.mock('@/lib/navigation', () => ({ reloadPage: vi.fn(), loadPage: vi.fn() }));

function Broken(): never {
  throw new Error('render failed');
}

// a page whose chunk is gone, as an open tab sees it after a redeploy
const MissingChunk = lazy(() =>
  Promise.reject(
    new TypeError('Failed to fetch dynamically imported module: /assets/AnalyticsPage-old.js'),
  ),
);

// firefox rejects the imports in flight when the page starts to unload
const AbortedChunk = lazy(
  () =>
    new Promise<never>((_, reject) =>
      setTimeout(() =>
        reject(new TypeError('error loading dynamically imported module: /assets/HealthPage.js')),
      ),
    ),
);

function Shell() {
  const { pathname } = useLocation();
  return (
    <>
      <Link to="/assets">Assets</Link>
      <ErrorBoundary resetKey={pathname}>
        <Suspense fallback={<p>loading</p>}>
          <Routes>
            <Route path="/broken" element={<Broken />} />
            <Route path="/analytics" element={<MissingChunk />} />
            <Route path="/health" element={<AbortedChunk />} />
            <Route path="/assets" element={<p>Assets page</p>} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </>
  );
}

const renderAt = (route: string) =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <Shell />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.mocked(reloadPage).mockClear();
  sessionStorage.clear();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  window.dispatchEvent(new Event('pageshow'));
});

describe('ErrorBoundary', () => {
  it('recovers when the user navigates away from a broken page', async () => {
    renderAt('/broken');
    expect(await screen.findByText('Something went wrong')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Assets' }));
    expect(await screen.findByText('Assets page')).toBeInTheDocument();
    expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    expect(reloadPage).not.toHaveBeenCalled();
  });

  it('waits for the connection instead of reloading when a chunk fails offline', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    renderAt('/analytics');
    expect(await screen.findByText('You are offline')).toBeInTheDocument();
    expect(reloadPage).not.toHaveBeenCalled();
    online.mockReturnValue(true);
    window.dispatchEvent(new Event('online'));
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it('does not reload over a navigation the user started, which cancels the chunk in firefox', async () => {
    renderAt('/health');
    // the user typed another address: the page starts to unload
    window.dispatchEvent(new Event('beforeunload'));
    expect(await screen.findByText('This page could not be loaded')).toBeInTheDocument();
    expect(reloadPage).not.toHaveBeenCalled();
  });

  it('reloads once for a chunk that a redeploy removed, then shows the error', async () => {
    renderAt('/analytics');
    expect(await screen.findByText('This page could not be loaded')).toBeInTheDocument();
    expect(reloadPage).toHaveBeenCalledTimes(1);

    // the reloaded page still cannot load it: no second reload, no loop
    vi.mocked(reloadPage).mockClear();
    renderAt('/analytics');
    await screen.findAllByText('This page could not be loaded');
    expect(reloadPage).not.toHaveBeenCalled();
  });
});
