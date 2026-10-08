import { useEffect } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes, useSearchParams } from 'react-router';
import { describe, expect, it } from 'vitest';
import { PageTransition } from './PageTransition';

function Page({ name, mounts }: { name: string; mounts: string[] }) {
  const [params] = useSearchParams();
  useEffect(() => {
    mounts.push(name);
  }, [name, mounts]);
  return (
    <div>
      <h1>{name}</h1>
      <p>filter {params.get('q') ?? 'none'}</p>
      <Link to="/b">to b</Link>
      <Link to="/a?q=x">filter a</Link>
    </div>
  );
}

function renderApp(mounts: string[]) {
  return render(
    <MemoryRouter initialEntries={['/a']}>
      <PageTransition>
        <Routes>
          <Route path="/a" element={<Page name="a" mounts={mounts} />} />
          <Route path="/b" element={<Page name="b" mounts={mounts} />} />
        </Routes>
      </PageTransition>
    </MemoryRouter>,
  );
}

describe('PageTransition', () => {
  it('mounts each page once per navigation', async () => {
    const mounts: string[] = [];
    renderApp(mounts);
    expect(mounts).toEqual(['a']);
    await userEvent.click(screen.getByRole('link', { name: 'to b' }));
    expect(screen.getByRole('heading', { name: 'b' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'a' })).not.toBeInTheDocument();
    expect(mounts).toEqual(['a', 'b']);
  });

  it('keeps the page mounted when only the search changes', async () => {
    const mounts: string[] = [];
    renderApp(mounts);
    const wrapper = screen
      .getByRole('heading', { name: 'a' })
      .closest('[data-slot="page-transition"]');
    await userEvent.click(screen.getByRole('link', { name: 'filter a' }));
    expect(screen.getByText('filter x')).toBeInTheDocument();
    expect(mounts).toEqual(['a']);
    expect(
      screen.getByRole('heading', { name: 'a' }).closest('[data-slot="page-transition"]'),
    ).toBe(wrapper);
  });
});
