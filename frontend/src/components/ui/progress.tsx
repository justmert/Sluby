import * as React from 'react';
import { cn } from '@/lib/utils';
import { Progress as ProgressPrimitive } from 'radix-ui';

function Progress({
  className,
  value,
  smooth = false,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & {
  /**
   * For a bar that tracks a polled value: it eases over --duration-progress
   * (1200 ms), which is shorter than the fastest poll, so it glides between
   * readings without trailing the printed number. Off, it moves in 300 ms.
   */
  smooth?: boolean;
}) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        'relative flex h-1 w-full items-center overflow-x-hidden rounded-full bg-muted',
        className,
      )}
      value={value}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        data-smooth={smooth || undefined}
        className={cn(
          'size-full flex-1 bg-progress transition-transform ease-out-soft',
          smooth ? 'duration-(--duration-progress)' : 'duration-300',
        )}
        style={{ transform: `translateX(-${100 - Math.min(100, Math.max(0, value ?? 0))}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
