import type { LucideIcon } from 'lucide-react';
import { FadeSwap } from '@/components/motion';
import { StatValue } from './StatValue';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { NO_VALUE } from '@/lib/formatters';
import { lateReveal } from '@/lib/motion';
import { cn } from '@/lib/utils';

const figure = 'block font-heading text-figure tabular-nums';

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  /** undefined while loading, null when there is no figure to show (an en dash) */
  value: number | null | undefined;
  format?: (n: number) => string;
  /** the data could not load, so there is nothing to wait for */
  failed?: boolean;
  /** null while the hint waits on the same data as the value; leave out for none */
  hint?: React.ReactNode;
  /** the hint is long enough to take two lines on a narrow card */
  longHint?: boolean;
  /** why there is no figure, shown as a tooltip on the dash ("No requests yet") */
  emptyReason?: string;
}

function EmptyFigure({ reason }: { reason?: string }) {
  const dash = (
    <span
      className={cn(figure, 'w-fit text-muted-foreground')}
      tabIndex={reason ? 0 : undefined}
      aria-label={reason ? `${NO_VALUE}, ${reason}` : undefined}
    >
      {NO_VALUE}
    </span>
  );
  if (!reason) return dash;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{dash}</TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

/**
 * A small card with one figure: an icon and label, the figure in the figure
 * type role (figtree 24/32, tabular), and an optional hint line.
 *
 *   <StatCard icon={Film} label="Videos" value={stats?.total} hint="1 failed" />
 * Loading, the figure and the hint keep the
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
  emptyReason,
}: StatCardProps) {
  const loading = value === undefined && !failed;
  return (
    <Card size="sm" className="h-full">
      <CardHeader>
        <CardDescription className="flex min-w-0 items-start gap-2">
          <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span className="line-clamp-2 min-w-0">{label}</span>
        </CardDescription>
        <CardTitle as="p">
          <FadeSwap swapKey={loading ? 'loading' : 'ready'}>
            {loading ? (
              <StatValue value={undefined} className={lateReveal} />
            ) : value === undefined || value === null ? (
              <EmptyFigure reason={failed ? 'Could not load' : emptyReason} />
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
                  <Skeleton className={cn('my-0.5 h-3 w-36 max-w-full', lateReveal)} />
                  {longHint && (
                    <Skeleton
                      className={cn('my-0.5 hidden h-3 w-20 @max-[11rem]:block', lateReveal)}
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
