import * as React from 'react';
import { cn } from '@/lib/utils';

/** A keyboard key hint, such as the ⌘K on the search button or / in a search field. */
function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        'pointer-events-none inline-flex h-5 min-w-5 items-center justify-center gap-0.5 rounded-sm border bg-transparent px-1.5 font-mono text-xs text-subtle-foreground select-none',
        className,
      )}
      {...props}
    />
  );
}

export { Kbd };
