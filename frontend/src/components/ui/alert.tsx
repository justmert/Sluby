import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

// the design's notes: a card with an 18px icon in the note's colour and
// plain text beside it. an error also takes a red edge; success and warning
// keep the neutral edge and let the icon carry the tone
const alertVariants = cva(
  "group/alert relative grid w-full gap-0.5 rounded-xl border bg-card px-3.5 py-3 text-left text-sm text-card-foreground has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-24 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2.5 *:[svg]:row-span-2 *:[svg]:mt-px *:[svg:not([class*='size-'])]:size-4.5",
  {
    variants: {
      variant: {
        default: '*:[svg]:text-muted-foreground',
        success: '*:[svg]:text-success',
        warning: '*:[svg]:text-warning-icon',
        destructive: 'border-destructive-line *:[svg]:text-destructive',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        'font-normal group-has-[>svg]/alert:col-start-2 group-has-data-[slot=alert-description]/alert:font-medium [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground',
        className,
      )}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        'text-sm text-balance text-muted-foreground md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4',
        className,
      )}
      {...props}
    />
  );
}

function AlertAction({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-action"
      className={cn('absolute top-1/2 right-2.5 -translate-y-1/2', className)}
      {...props}
    />
  );
}

export { Alert, AlertTitle, AlertDescription, AlertAction };
