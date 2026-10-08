import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The raw error text behind a friendly message, folded away under "Details".
 * It is there for whoever reads server logs; it is never the headline.
 */
export function ErrorDetails({ detail, className }: { detail?: string; className?: string }) {
  if (!detail) return null;
  return (
    <details data-slot="error-details" className={cn('group/details text-xs', className)}>
      <summary className="inline-flex cursor-pointer items-center gap-1 rounded-sm text-muted-foreground select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="size-3.5 transition-transform duration-150 group-open/details:rotate-90"
        />
        Details
      </summary>
      <p className="mt-1.5 font-mono break-all whitespace-pre-wrap text-muted-foreground">
        {detail}
      </p>
    </details>
  );
}
