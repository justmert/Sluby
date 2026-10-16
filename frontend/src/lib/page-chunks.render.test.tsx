import { Suspense, useState } from 'react';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { lazyPage, loadPage } from './page-chunks';

function counterPage() {
  return function Counter() {
    const [n, setN] = useState(0);
    return <button onClick={() => setN(n + 1)}>clicked {n}</button>;
  };
}

describe('lazy pages', () => {
  it('renders a page whose code already loaded without showing its skeleton', async () => {
    // react holds a revealed fallback for 300 ms, so a page that suspends
    // even once starts its own requests that much later
    const Page = counterPage();
    const load = () => Promise.resolve({ default: Page });
    const Lazy = lazyPage(load);
    await loadPage(load);
    render(
      <Suspense fallback={<p>skeleton</p>}>
        <Lazy />
      </Suspense>,
    );
    expect(screen.queryByText('skeleton')).toBeNull();
    expect(screen.getByRole('button', { name: 'clicked 0' })).toBeInTheDocument();
  });

  it('still suspends for code that has not loaded, then keeps the page mounted', async () => {
    const Page = counterPage();
    const load = () => Promise.resolve({ default: Page });
    const Lazy = lazyPage(load);
    const { rerender } = render(
      <Suspense fallback={<p>skeleton</p>}>
        <Lazy />
      </Suspense>,
    );
    expect(screen.getByText('skeleton')).toBeInTheDocument();
    const button = await screen.findByRole('button', { name: 'clicked 0' });
    act(() => button.click());
    // the code is in the cache now; a re-render must not swap the component and lose state
    rerender(
      <Suspense fallback={<p>skeleton</p>}>
        <Lazy />
      </Suspense>,
    );
    expect(screen.getByRole('button', { name: 'clicked 1' })).toBeInTheDocument();
  });
});
