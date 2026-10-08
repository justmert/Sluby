import { cn } from '@/lib/utils';

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        // the shimmer is a pseudo element, so it never covers or shifts content;
        // under reduced motion the block stays flat
        'relative overflow-hidden rounded-md bg-muted',
        'before:absolute before:inset-0 before:-translate-x-full before:bg-linear-to-r before:from-transparent before:via-foreground/6 before:to-transparent motion-safe:before:animate-shimmer motion-reduce:before:hidden',
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
