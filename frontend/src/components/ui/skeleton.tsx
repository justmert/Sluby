import { cn } from '@/lib/utils';

// `as="span"` for a bar inside a line of text, where a div is not allowed
function Skeleton({
  as: Tag = 'div',
  className,
  ...props
}: React.ComponentProps<'div'> & { as?: 'div' | 'span' }) {
  return (
    <Tag
      data-slot="skeleton"
      className={cn(
        // the shimmer is a fixed-width stripe on a pseudo element: it never shifts
        // content, and every block sweeps at the same speed whatever its width.
        // under reduced motion the block stays flat
        'relative overflow-hidden rounded-[6px] bg-muted',
        'before:absolute before:inset-y-0 before:left-0 before:w-48 before:-translate-x-full before:bg-linear-to-r before:from-transparent before:via-foreground/6 before:to-transparent motion-safe:before:animate-shimmer motion-reduce:before:hidden',
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
