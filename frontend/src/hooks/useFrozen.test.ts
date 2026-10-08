import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useFrozen } from './useFrozen';

describe('useFrozen', () => {
  it('follows the value while open', () => {
    const { result, rerender } = renderHook(({ v, open }) => useFrozen(v, open), {
      initialProps: { v: ['a'] as string[] | null, open: true },
    });
    expect(result.current).toEqual(['a']);
    rerender({ v: ['a', 'b'], open: true });
    expect(result.current).toEqual(['a', 'b']);
  });

  it('keeps the last open value after closing clears it', () => {
    const { result, rerender } = renderHook(({ v, open }) => useFrozen(v, open), {
      initialProps: { v: ['a', 'b'] as string[] | null, open: true },
    });
    rerender({ v: null, open: false });
    expect(result.current).toEqual(['a', 'b']);
  });

  it('picks up the new value when opened again', () => {
    const { result, rerender } = renderHook(({ v, open }) => useFrozen(v, open), {
      initialProps: { v: 'first' as string | null, open: true },
    });
    rerender({ v: null, open: false });
    rerender({ v: 'second', open: true });
    expect(result.current).toBe('second');
    rerender({ v: null, open: false });
    expect(result.current).toBe('second');
  });
});
