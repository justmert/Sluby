import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { agoText, routeSkeletonWasVisible, useRouteSkeletonVisibility } from './live';

afterEach(() => vi.useRealTimers());

describe('agoText', () => {
  it('reads like a person would say it', () => {
    expect(agoText(2_000)).toBe('just now');
    expect(agoText(12_000)).toBe('12 s ago');
    expect(agoText(3 * 60_000)).toBe('3 min ago');
    expect(agoText(2 * 3_600_000)).toBe('2 h ago');
  });
});

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
