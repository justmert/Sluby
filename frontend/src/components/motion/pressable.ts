import { cn } from '@/lib/utils';

/**
 * Hover lift and press scale for a clickable card or tile. It is only
 * classes, so it goes on the real link or button and keeps its semantics.
 * The lift and scale are motion-safe; the shadow stays under reduced motion.
 */
export function pressable(className?: string) {
  return cn(
    'transition-[translate,scale,box-shadow] duration-200 ease-out-soft hover:shadow-md',
    'motion-safe:hover:-translate-y-0.5 motion-safe:active:translate-y-0 motion-safe:active:scale-[0.98]',
    'outline-none focus-visible:ring-3 focus-visible:ring-ring',
    className,
  );
}
