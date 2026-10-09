/*
 * shared motion tokens for the studio.
 *
 * what animates: things entering or leaving (pages, list items, overlays,
 * toasts), state swaps (skeleton to content, status badges), numbers that
 * change, and small hover or press feedback. motion should explain a change,
 * so it stays short: fast for feedback and menus, base for most content,
 * slow only for large surfaces like sheets.
 *
 * what never animates: text people are reading or typing into, focus rings,
 * scroll position, table sorting, anything on first paint that is not new
 * to the user (the theme, the shell), anything longer than slow, and the
 * page itself during a theme switch (a view transition crossfades one
 * snapshot instead).
 *
 * reduced motion: the app runs under <MotionConfig reducedMotion="user">, so
 * when the os asks for less motion, motion skips transform and layout
 * animations (x, y, scale, height) and keeps opacity fades. css animations
 * are cut by the prefers-reduced-motion block in index.css and the
 * motion-safe / motion-reduce variants, except spinners, which keep turning
 * slowly as the one sign that work goes on. usePrefersReducedMotion covers the
 * cases neither reaches, like counting a number up.
 *
 * the css side mirrors these values: duration-150/200/300 and ease-out-soft
 * in index.css are the same numbers. a css keyframe animation (animate-in)
 * pairs its duration-* class with transition-none: duration-* alone also
 * turns on `transition: all` for that element.
 */
import { useContext, useSyncExternalStore } from 'react';
import { MotionConfigContext, type Transition, type Variants } from 'motion/react';

/** durations in seconds, which is what motion takes */
export const duration = { fast: 0.15, base: 0.2, slow: 0.3 } as const;

/**
 * the same durations in milliseconds, for timers and css. progress is how
 * long a polled progress bar eases (--duration-progress in index.css).
 */
export const durationMs = { fast: 150, base: 200, slow: 300, progress: 1200 } as const;

/** a soft ease-out; matches --ease-out-soft in index.css */
export const easeOut = [0.22, 1, 0.36, 1] as const;

/** a quick spring with a hint of settle, for layout and press feedback */
export const spring: Transition = { type: 'spring', visualDuration: duration.slow, bounce: 0.15 };

export const transition = {
  fast: { duration: duration.fast, ease: easeOut },
  base: { duration: duration.base, ease: easeOut },
  slow: { duration: duration.slow, ease: easeOut },
} satisfies Record<string, Transition>;

/** a one-off "this just arrived" flash: a status that settled, a new delivery */
export const highlight: Transition = { duration: 1.4, delay: 0.3, ease: easeOut };

/**
 * classes for a skeleton that stays invisible for its first 150 ms, so a
 * quick answer never flashes one. below a `data-instant-skeletons` element it
 * shows at once, for a page taking over from a route skeleton already on screen.
 */
export const lateReveal =
  'animate-in fade-in-0 fill-mode-backwards delay-150 duration-200 transition-none in-data-instant-skeletons:animate-none';

// every variant set uses the same three labels, so a parent can drive its
// children with initial="hidden" animate="visible" exit="exit"
export const fade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: transition.base },
  exit: { opacity: 0, transition: transition.fast },
};

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: transition.base },
  exit: { opacity: 0, y: -4, transition: transition.fast },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1, transition: transition.base },
  exit: { opacity: 0, scale: 0.96, transition: transition.fast },
};

/** stagger step between list items, in seconds */
export const staggerStep = 0.04;

// items past this index share the last delay, so item 40 of a long list does
// not wait over a second to show up
const staggerCap = 8;

export const listContainer: Variants = {
  hidden: {},
  visible: { transition: { delayChildren: (i: number) => Math.min(i, staggerCap) * staggerStep } },
  exit: {},
};

export const listItem: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, y: 0, transition: transition.base },
  exit: { opacity: 0, scale: 0.98, transition: transition.fast },
};

export const collapse: Variants = {
  hidden: { height: 0, opacity: 0 },
  visible: {
    height: 'auto',
    opacity: 1,
    transition: { height: transition.base, opacity: transition.fast },
  },
  exit: {
    height: 0,
    opacity: 0,
    transition: { height: transition.base, opacity: { duration: duration.fast * 0.66 } },
  },
};

const reduceQuery = '(prefers-reduced-motion: reduce)';

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(reduceQuery);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

/**
 * true when animations should be cut: the os asks for reduced motion (and
 * the nearest MotionConfig says "user"), the MotionConfig says "always", or
 * animations are skipped outright. unlike motion's useReducedMotion this
 * follows the os setting live and honours MotionConfig.
 */
export function usePrefersReducedMotion(): boolean {
  const { reducedMotion, skipAnimations } = useContext(MotionConfigContext);
  const osReduce = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(reduceQuery).matches,
    () => false,
  );
  if (skipAnimations) return true;
  if (reducedMotion === 'always') return true;
  if (reducedMotion === 'never') return false;
  return osReduce;
}
