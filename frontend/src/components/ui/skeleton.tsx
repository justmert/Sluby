import { cn } from '@/lib/cn';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-lg bg-white/[0.05] animate-[skeleton-pulse_2s_cubic-bezier(0.4,0,0.6,1)_infinite]',
        className,
      )}
      {...props}
    />
  );
}
