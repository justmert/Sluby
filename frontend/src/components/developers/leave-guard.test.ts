import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLeaveGuard } from './leave-guard';

const guarded = () => 'slubyLeaveGuard' in (window.history.state ?? {});

// jsdom runs back(), go() and their popstate asynchronously, like a browser
const settle = () => new Promise((r) => setTimeout(r, 30));

beforeEach(() => {
  window.history.replaceState({ page: 'before' }, '', '/studio/developers');
  window.history.pushState({ page: 'key' }, '', '/studio/developers/keys');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useLeaveGuard and the back button', () => {
  it('asks before back leaves an uncopied secret, and stays on stay', async () => {
    const { result } = renderHook(() => useLeaveGuard(true, vi.fn()));
    expect(guarded()).toBe(true);

    act(() => window.history.back());
    await waitFor(() => expect(result.current.pending).toBe('#back'));
    // still on the page, held again for the next press
    expect(window.location.pathname).toBe('/studio/developers/keys');
    expect(guarded()).toBe(true);

    act(() => result.current.stay());
    expect(result.current.pending).toBeNull();
    expect(window.location.pathname).toBe('/studio/developers/keys');
  });

  it('goes where back was going once the person chooses to leave', async () => {
    const { result } = renderHook(() => useLeaveGuard(true, vi.fn()));
    act(() => window.history.back());
    await waitFor(() => expect(result.current.pending).toBe('#back'));

    act(() => result.current.leave());
    await waitFor(() => expect(window.location.pathname).toBe('/studio/developers'));
    expect(window.history.state).toMatchObject({ page: 'before' });
  });

  it('takes its history entry off once the secret is copied, so back works as usual', async () => {
    const { rerender } = renderHook(({ active }) => useLeaveGuard(active, vi.fn()), {
      initialProps: { active: true },
    });
    expect(guarded()).toBe(true);
    rerender({ active: false });
    await settle();
    expect(guarded()).toBe(false);
    expect(window.history.state).toMatchObject({ page: 'key' });
  });

  it('does not hold back while nothing is uncopied', async () => {
    const { result } = renderHook(() => useLeaveGuard(false, vi.fn()));
    expect(guarded()).toBe(false);
    act(() => window.history.back());
    await waitFor(() => expect(window.location.pathname).toBe('/studio/developers'));
    expect(result.current.pending).toBeNull();
  });
});
