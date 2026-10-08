import type { LucideIcon } from 'lucide-react';
import { FadeSwap } from '@/components/motion';
import { StatValue } from '@/components/shared/StatValue';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { lateSkeleton } from './live';

const figure = 'block font-heading text-2xl leading-8 font-semibold';

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  /** undefined while loading, null when there is no figure to show (the card says n/a) */
  value: number | null | undefined;
  format?: (n: number) => string;
  /** the data could not load, so there is nothing to wait for */
  failed?: boolean;
  /** null while the hint waits on the same data as the value; leave out for none */
  hint?: React.ReactNode;
  /** the hint is long enough to take two lines on a narrow card */
  longHint?: boolean;
}

/**
 * A small card with one figure. Loading, the figure and the hint keep the
 * box they will have, then crossfade in; later values count to the new number.
 */
export function StatCard({
  icon: Icon,
  label,
  value,
  format,
  failed = false,
  hint,
  longHint = false,
}: StatCardProps) {
  const loading = value === undefined && !failed;
  return (
    <Card size="sm" className="h-full">
      <CardHeader>
        <CardDescription className="flex min-w-0 items-center gap-2">
          <Icon className="size-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{label}</span>
        </CardDescription>
        <CardTitle>
          <FadeSwap swapKey={loading ? 'loading' : 'ready'}>
            {loading ? (
              <StatValue value={undefined} className={lateSkeleton} />
            ) : value === undefined || value === null ? (
              <span className={cn(figure, 'text-muted-foreground')}>{failed ? '-' : 'n/a'}</span>
            ) : (
              <StatValue value={value} format={format} />
            )}
          </FadeSwap>
        </CardTitle>
      </CardHeader>
      {hint !== undefined && (
        <CardContent className="min-h-4 text-xs text-muted-foreground">
          <FadeSwap swapKey={hint === null ? 'loading' : 'ready'}>
            {hint === null ? (
              failed ? null : (
                // a long hint wraps to two lines on a narrow card, so its placeholder does too
                <div className="@container">
                  <Skeleton className={cn('my-0.5 h-3 w-36 max-w-full', lateSkeleton)} />
                  {longHint && (
                    <Skeleton
                      className={cn('my-0.5 hidden h-3 w-20 @max-[11rem]:block', lateSkeleton)}
                    />
                  )}
                </div>
              )
            ) : (
              hint
            )}
          </FadeSwap>
        </CardContent>
      )}
    </Card>
  );
}
