import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Slot } from 'radix-ui';

// the design's button: 36px tall, 8px corners, a 1px edge, colour easing over
// 150 ms and a press to 97% over 100 ms, only when motion is allowed. a menu
// trigger skips the press, so its menu does not open off an anchor that is
// still shrinking. keyboard focus is a 2px petrol ring 2px out.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,scale] duration-150 ease-design outline-none select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid motion-safe:active:not-aria-[haspopup]:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // primary: petrol, a darker petrol on hover (a lighter one in dark)
        default: 'border-primary bg-primary text-primary-foreground hover:bg-primary-hover',
        // the design's secondary: the neutral surface with a strong edge
        outline:
          'border-border-strong bg-card text-foreground hover:bg-muted aria-expanded:bg-muted',
        secondary:
          'bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground',
        // the design's quiet button and its icon buttons: no edge, softer text
        // until hovered
        ghost:
          'text-secondary-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground',
        // destructive is the confirm: the last, irreversible button in a
        // dialog, so it is solid. destructive-outline is every trigger that
        // opens such a dialog (page header, table row, bulk bar): a red edge
        // and red text on the neutral surface, never a red wash.
        destructive:
          'border-destructive-solid bg-destructive-solid text-destructive-solid-foreground hover:bg-[color-mix(in_oklab,var(--destructive-solid),var(--foreground)_14%)] focus-visible:outline-destructive',
        'destructive-outline':
          'border-destructive-line bg-card text-destructive hover:bg-muted aria-expanded:bg-muted focus-visible:outline-destructive',
        link: 'text-primary underline-offset-4 hover:text-primary-hover hover:underline',
      },
      // a finger gets 40px controls (36 small, 44 large) on a touch screen,
      // while a mouse keeps the design's sizes: 36 default, 32 for buttons in
      // a row, 26 for the copy buttons in a code header (A11Y-47)
      size: {
        default:
          'h-9 gap-2 px-3.5 pointer-coarse:h-10 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3',
        xs: "h-6.5 gap-1 px-2 text-xs pointer-coarse:h-8 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        sm: 'h-8 gap-1.5 px-3 pointer-coarse:h-9 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5',
        lg: 'h-10 gap-2 px-4 pointer-coarse:h-11 has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5',
        icon: 'size-9 pointer-coarse:size-11',
        'icon-xs': "size-6.5 pointer-coarse:size-9 [&_svg:not([class*='size-'])]:size-3.5",
        'icon-sm': 'size-8 pointer-coarse:size-10',
        'icon-lg': 'size-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
