import { useState, useEffect } from 'react';

/**
 * Debounce a value by `delay` milliseconds.
 * Returns the value only after it has been stable for the given duration.
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
