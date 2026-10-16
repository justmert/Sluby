import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Slot } from 'radix-ui';

// one tone per meaning, see the token notes in index.css. progress is work
// under way, warning is something that needs attention, and code is an api
// value (a scope, an event name, an object id). the fill stays neutral; the
// edge and the text carry the tone, so a row of chips never turns into a row
// of coloured blocks.
const badgeVariants = cva(
  'group/badge inline-flex h-5.5 w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-full border border-transparent px-2 text-xs font-semibold whitespace-nowrap transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&>svg]:pointer-events-none [&>svg]:size-3!',
  {
    variants: {
      variant: {
        secondary: 'border-border-strong bg-card text-secondary-foreground [a]:hover:bg-muted',
        outline: 'border-border text-foreground [a]:hover:bg-muted',
        success: 'border-success-line bg-card text-success',
        progress: 'border-progress-line bg-card text-progress-foreground',
        warning: 'border-warning-line bg-card text-warning-foreground',
        destructive: 'border-destructive-line bg-card text-destructive',
        info: 'border-border-strong bg-card text-info',
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
