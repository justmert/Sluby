import { act, render, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRouteSkeletonVisibility } from '@/components/dashboard/live';
import { lateReveal } from '@/lib/motion';
import { PageContainer } from './PageContainer';

afterEach(() => vi.useRealTimers());

// a page that takes over from a visible route skeleton
const takeOver = (children: React.ReactNode) => {
  vi.useFakeTimers();
  const route = renderHook(() => useRouteSkeletonVisibility());
  act(() => vi.advanceTimersByTime(150));
  const page = render(<PageContainer>{children}</PageContainer>);
  route.unmount();
  vi.useRealTimers();
  return page;
};

const container = (view: ReturnType<typeof render>) =>
  view.container.querySelector('[data-slot="page-container"]');

describe('PageContainer', () => {
  it('shows its skeletons at once when it takes over from a route skeleton already on screen', () => {
    const page = takeOver(<div className={lateReveal}>loading</div>);
    expect(container(page)).toHaveAttribute('data-instant-skeletons');
  });

  it('keeps the 150 ms wait when nothing was on screen before it', () => {
    const page = render(<PageContainer>page</PageContainer>);
    expect(container(page)).not.toHaveAttribute('data-instant-skeletons');
  });

  it('lets skeletons that show after the first ones are gone wait again', async () => {
    const page = takeOver(<div className={lateReveal}>loading</div>);
    expect(container(page)).toHaveAttribute('data-instant-skeletons');
    page.rerender(<PageContainer>loaded</PageContainer>);
    await waitFor(() => expect(container(page)).not.toHaveAttribute('data-instant-skeletons'));
    page.rerender(
      <PageContainer>
        <div className={lateReveal}>refetching</div>
      </PageContainer>,
    );
    expect(container(page)).not.toHaveAttribute('data-instant-skeletons');
  });

  it('keeps showing its first skeletons at once while they are on screen', async () => {
    const page = takeOver(<div className={lateReveal}>loading</div>);
    page.rerender(
      <PageContainer>
        <div className={lateReveal}>still loading</div>
      </PageContainer>,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(container(page)).toHaveAttribute('data-instant-skeletons');
  });
});
