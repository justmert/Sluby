import * as React from 'react';
import { cn } from '@/lib/utils';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-16 w-full rounded-md border border-input bg-card px-3 py-2 text-base transition-[color,background-color,border-color] duration-150 ease-design outline-none placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-3 focus-visible:outline-offset-0 focus-visible:outline-primary-ring focus-visible:outline-solid disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 aria-invalid:border-[1.5px] aria-invalid:border-destructive md:text-sm',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
