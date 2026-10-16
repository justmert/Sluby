import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { Option } from './OptionList';

/**
 * OptionList before its ticks are known: the same names and details in the
 * same rows, with a bar for each box. Separate from OptionList so a route
 * skeleton draws it without the checkbox and form code.
 */
export function OptionListLoading({
  options,
  className,
  barClassName,
}: {
  options: Option[];
  /** classes for the list, as given to OptionList */
  className?: string;
  /** classes for the bars, e.g. a late reveal */
  barClassName?: string;
}) {
  return (
    <div className={cn('grid gap-3', className)}>
      {options.map((o) => (
        <div key={o.value} className="flex items-start gap-3">
          <Skeleton className={cn('mt-0.5 size-4 shrink-0 rounded-[4px]', barClassName)} />
          <div className="grid min-w-0 gap-0.5">
            {/* as Label draws it */}
            <span className="flex items-center gap-2 font-mono text-sm leading-5 font-normal">
              {o.value}
            </span>
            <p className="text-xs text-muted-foreground">{o.detail}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
