import * as React from 'react';
import { cn } from '@/lib/utils';
import { Progress as ProgressPrimitive } from 'radix-ui';

function Progress({
  className,
  value,
  smooth = false,
  moving = false,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root> & {
  /**
   * For a bar that tracks a polled value: it eases over --duration-progress
   * (1200 ms), which is shorter than the fastest poll, so it glides between
   * readings without trailing the printed number. Off, it moves in 400 ms.
   */
  smooth?: boolean;
  /**
   * The work behind the bar is running right now: a soft light crosses the
   * fill, so a bar that sits on one number for a while still looks alive.
   * Only while running; a paused, failed or finished bar stays still.
   */
  moving?: boolean;
}) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        'relative flex h-1.5 w-full items-center overflow-x-hidden rounded-full bg-sunken',
        className,
      )}
      value={value}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        data-smooth={smooth || undefined}
        data-moving={moving || undefined}
        className={cn(
          'relative size-full flex-1 overflow-hidden rounded-full bg-progress transition-transform ease-design',
          smooth ? 'duration-(--duration-progress)' : 'duration-400',
          // the light rides on the visible part of the fill: the indicator is
          // shifted left by the part still to do, so its right edge is the tip
          moving &&
            'after:absolute after:inset-y-0 after:right-0 after:w-(--progress-done) after:-translate-x-full after:bg-linear-to-r after:from-transparent after:via-white/40 after:to-transparent motion-safe:after:animate-sheen motion-reduce:after:hidden',
        )}
        style={
          {
            transform: `translateX(-${100 - clamp(value)}%)`,
            '--progress-done': `${clamp(value)}%`,
          } as React.CSSProperties
        }
      />
    </ProgressPrimitive.Root>
  );
}

const clamp = (value: number | null | undefined) => Math.min(100, Math.max(0, value ?? 0));

export { Progress };
