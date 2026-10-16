'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Toggle as TogglePrimitive } from 'radix-ui';

const toggleVariants = cva(
  "group/toggle inline-flex items-center justify-center gap-1 rounded-md text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,scale] duration-150 ease-design outline-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid motion-safe:active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 aria-invalid:border-destructive aria-pressed:bg-muted data-[state=on]:bg-muted [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        outline: 'border border-border-strong bg-card hover:bg-muted',
        // an item of a segmented control (ToggleGroup variant="segmented"):
        // the same look as TabsList, a sunken track with the chosen segment
        // raised on the surface
        segmented:
          'rounded-[7px] px-3 text-[13px] text-muted-foreground hover:bg-transparent hover:text-foreground aria-pressed:bg-card data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-[0_1px_2px_var(--shadow-tint)]',
        // the phone board's filter pills: a round chip with a strong edge, a
        // 1.5px petrol edge and petrol text when chosen
        pill: 'h-9 rounded-full border border-border-strong bg-card px-3.5 text-foreground hover:bg-muted aria-pressed:border-[1.5px] aria-pressed:border-primary aria-pressed:bg-card aria-pressed:font-semibold aria-pressed:text-primary data-[state=on]:border-[1.5px] data-[state=on]:border-primary data-[state=on]:bg-card data-[state=on]:font-semibold data-[state=on]:text-primary pointer-coarse:h-10',
      },
      size: {
        default:
          'h-8 min-w-8 px-2.5 pointer-coarse:h-10 pointer-coarse:min-w-10 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
        sm: "h-7 min-w-7 px-2.5 text-xs pointer-coarse:h-9 pointer-coarse:min-w-9 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-9 min-w-9 px-2.5 pointer-coarse:h-11 pointer-coarse:min-w-11 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Toggle({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Toggle, toggleVariants };
