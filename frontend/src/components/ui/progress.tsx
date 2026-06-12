import * as ProgressPrimitive from '@radix-ui/react-progress';
import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

export const Progress = forwardRef<
  React.ComponentRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, ...props }, ref) => {
  const v = value ?? 0;
  const colorClass =
    v >= 80
      ? 'bg-gradient-to-r from-emerald-500 to-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.25)]'
      : v >= 50
        ? 'bg-gradient-to-r from-teal-500 to-teal-400 shadow-[0_0_12px_rgba(20,184,166,0.25)]'
        : v >= 25
          ? 'bg-gradient-to-r from-amber-500 to-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.25)]'
          : 'bg-gradient-to-r from-red-500 to-red-400 shadow-[0_0_12px_rgba(239,68,68,0.25)]';

  return (
    <ProgressPrimitive.Root
      ref={ref}
      value={value}
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-white/[0.05]', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className={cn(
          'h-full rounded-full transition-all duration-500 ease-out relative overflow-hidden',
          colorClass,
          v < 100 &&
            'after:absolute after:inset-0 after:rounded-full after:bg-gradient-to-r after:from-transparent after:via-white/25 after:to-transparent after:animate-[progress-shimmer_2s_ease-in-out_infinite]',
        )}
        style={{ width: `${v}%` }}
      />
    </ProgressPrimitive.Root>
  );
});
Progress.displayName = 'Progress';
