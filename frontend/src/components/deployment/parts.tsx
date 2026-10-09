// pieces the health cards share: the card frame, a row skeleton and probe wording
import type { ReactNode } from 'react';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { lateReveal } from '@/lib/motion';
import { cn } from '@/lib/utils';

export function HealthCard({
  title,
  description,
  action,
  className,
  children,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn('h-full', className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** Placeholder label and value rows at the height of description list rows. */
export function RowsLoading({ count, className }: { count: number; className?: string }) {
  return (
    <div aria-hidden="true" className={cn('flex flex-col divide-y', className)}>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="flex h-10 items-center justify-between gap-4 first:h-7.5 first:items-start last:h-7.5 last:items-end"
        >
          <Skeleton className={cn('h-3.5 w-24', lateReveal)} />
          <Skeleton className={cn('h-3.5 w-20', lateReveal)} />
        </div>
      ))}
    </div>
  );
}
