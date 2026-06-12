import { cn } from '@/lib/cn';

export interface LiveDotProps {
  className?: string;
}

export function LiveDot({ className }: LiveDotProps) {
  return (
    <span className={cn('relative inline-flex h-2 w-2', className)}>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.4)]" />
    </span>
  );
}
