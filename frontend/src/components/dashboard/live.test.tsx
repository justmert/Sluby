import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { routeSkeletonWasVisible, useRouteSkeletonVisibility } from './live';

afterEach(() => vi.useRealTimers());

describe('route skeleton hand over', () => {
  it('counts a route skeleton as seen only once its 150 ms wait passed, until it goes', () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useRouteSkeletonVisibility());
    act(() => vi.advanceTimersByTime(149));
    expect(routeSkeletonWasVisible()).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(routeSkeletonWasVisible()).toBe(true);
    unmount();
    expect(routeSkeletonWasVisible()).toBe(false);
  });
});
