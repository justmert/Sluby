import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Slot } from 'radix-ui';

// one tone per meaning, see the token notes in index.css. progress is work
// under way, warning is something that needs attention, and code is an api
// value (a scope, an event name, an object id).
const badgeVariants = cva(
  'group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 text-xs font-medium whitespace-nowrap transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:pointer-events-none [&>svg]:size-3!',
  {
    variants: {
      variant: {
        secondary: 'bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80',
        outline: 'border-border text-foreground [a]:hover:bg-muted',
        success: 'bg-success/10 text-success dark:bg-success/15',
        progress: 'bg-progress/10 text-progress-foreground dark:bg-progress/15',
        warning: 'bg-warning/15 text-warning-foreground',
        destructive: 'bg-destructive/10 text-destructive dark:bg-destructive/20',
        info: 'bg-info/10 text-info dark:bg-info/15',
        code: 'rounded-sm bg-muted px-1.5 font-mono text-kbd text-foreground',
      },
    },
    defaultVariants: {
      variant: 'secondary',
    },
  },
);

function Badge({
  className,
  variant = 'secondary',
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span';

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
