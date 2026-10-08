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
 * to the user (the theme, the shell), and anything longer than slow.
 *
 * reduced motion: the app runs under <MotionConfig reducedMotion="user">, so
 * when the os asks for less motion, motion skips transform and layout
 * animations (x, y, scale, height) and keeps opacity fades. css animations
 * are cut by the prefers-reduced-motion block in index.css and the
 * motion-safe / motion-reduce variants. usePrefersReducedMotion covers the
 * cases neither reaches, like counting a number up.
 *
 * the css side mirrors these values: duration-150/200/300 and ease-out-soft
 * in index.css are the same numbers.
 */
import { useContext, useSyncExternalStore } from 'react';
import { MotionConfigContext, type Transition, type Variants } from 'motion/react';

/** durations in seconds, which is what motion takes */
export const duration = { fast: 0.15, base: 0.2, slow: 0.3 } as const;

/** the same durations in milliseconds, for timers and css */
export const durationMs = { fast: 150, base: 200, slow: 300 } as const;

/** a soft ease-out; matches --ease-out-soft in index.css */
export const easeOut = [0.22, 1, 0.36, 1] as const;

/** a quick spring with a hint of settle, for layout and press feedback */
export const spring: Transition = { type: 'spring', visualDuration: duration.slow, bounce: 0.15 };

export const transition = {
  fast: { duration: duration.fast, ease: easeOut },
  base: { duration: duration.base, ease: easeOut },
  slow: { duration: duration.slow, ease: easeOut },
} satisfies Record<string, Transition>;

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

export const pageTransition: Variants = {
  hidden: { opacity: 0, y: 4 },
  visible: { opacity: 1, y: 0, transition: transition.base },
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
