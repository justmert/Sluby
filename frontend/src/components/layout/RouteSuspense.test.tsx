import { lazy } from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { renderPage } from '@/test/render';
import { RouteSuspense } from './RouteSuspense';

// a page whose code never arrives, like a slow chunk
const Slow = lazy(() => new Promise<never>(() => {}));

describe('RouteSuspense', () => {
  it('shows the next page loading instead of keeping the old one on screen', async () => {
    renderPage(
      <>
        <Link to="/studio/settings">Settings</Link>
        <RouteSuspense>
          <Routes>
            <Route path="/studio" element={<h1>Dashboard</h1>} />
            <Route path="/studio/settings" element={<Slow />} />
          </Routes>
        </RouteSuspense>
      </>,
      { route: '/studio' },
    );
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Settings' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Loading page');
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument();
  });
});
