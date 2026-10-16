import * as React from 'react';
import { cn } from '@/lib/utils';

function Card({
  className,
  size = 'default',
  ...props
}: React.ComponentProps<'div'> & { size?: 'default' | 'sm' }) {
  return (
    <div
      data-slot="card"
      data-size={size}
      className={cn(
        'group/card flex flex-col gap-4 overflow-hidden rounded-xl border bg-card py-5 text-sm text-card-foreground [--card-spacing:--spacing(6)] [--card-title-size:var(--text-base)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:gap-3 data-[size=sm]:py-3.5 data-[size=sm]:[--card-spacing:--spacing(4)] data-[size=sm]:[--card-title-size:var(--text-sm)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl',
        className,
      )}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        'group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)',
        className,
      )}
      {...props}
    />
  );
}

// the size comes from the card as a variable instead of a group-data
// variant: a variant selector outranks a page's plain text-2xl and
// tailwind-merge cannot drop it, so stat values came out at 14px
// a heading (h2 by default) so screen readers can jump between cards; pass
// as="h3" under a section heading, or as="p" when the title is not a heading
// (a stat card's figure)
function CardTitle({
  className,
  as: Comp = 'h2',
  ...props
}: React.ComponentProps<'h2'> & { as?: 'h2' | 'h3' | 'h4' | 'p' | 'div' }) {
  return (
    <Comp
      data-slot="card-title"
      className={cn(
        'font-heading text-(length:--card-title-size) leading-6 font-semibold tracking-tight',
        className,
      )}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

function CardAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-action"
      className={cn('col-start-2 row-span-2 row-start-1 self-start justify-self-end', className)}
      {...props}
    />
  );
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="card-content" className={cn('px-(--card-spacing)', className)} {...props} />
  );
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        'flex items-center justify-end gap-2 rounded-b-xl border-t px-(--card-spacing) py-4',
        className,
      )}
      {...props}
    />
  );
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent };
