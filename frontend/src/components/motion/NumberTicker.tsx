import { useLayoutEffect, useRef } from 'react';
import { animate } from 'motion/react';
import { transition, usePrefersReducedMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';

const defaultFormat = (n: number) => Math.round(n).toLocaleString();

interface NumberTickerProps {
  value: number;
  /** turns the in-between and final numbers into text; defaults to a rounded, grouped integer */
  format?: (n: number) => string;
  className?: string;
}

/**
 * Counts from the previous value to the new one when `value` changes. The
 * first render shows the value as is. Screen readers get only the final
 * text: the counting digits are aria-hidden and written straight to the dom,
 * so nothing re-renders or gets announced per frame. Under reduced motion
 * the number just changes.
 */
export function NumberTicker({ value, format = defaultFormat, className }: NumberTickerProps) {
  const visual = useRef<HTMLSpanElement>(null);
  // what is on screen right now, so a change mid-count starts from there
  const shown = useRef<number | null>(null);
  const reduce = usePrefersReducedMotion();

  useLayoutEffect(() => {
    const el = visual.current;
    if (!el) return;
    const from = shown.current;
    const paint = (n: number) => {
      shown.current = n;
      el.textContent = format(n);
    };
    if (from === null || from === value || reduce) {
      paint(value);
      return;
    }
    paint(from);
    const controls = animate(from, value, {
      ...transition.slow,
      onUpdate: paint,
      // the last frame of a tween can land a hair off the target
      onComplete: () => paint(value),
    });
    return () => controls.stop();
  }, [value, format, reduce]);

  return (
    <span className={cn('tabular-nums', className)}>
      <span ref={visual} aria-hidden="true" />
      <span className="sr-only">{format(value)}</span>
    </span>
  );
}
