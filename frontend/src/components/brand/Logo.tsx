import { cn } from '@/lib/utils';

export function Logo({ className }: { className?: string }) {
  return (
    // decorative: next to it there is always the name, which a screen reader
    // would otherwise hear as "S Sluby"
    <div
      aria-hidden="true"
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground',
        className,
      )}
    >
      S
    </div>
  );
}
