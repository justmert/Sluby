import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          'flex h-10 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-zinc-100 shadow-sm shadow-black/10 placeholder:text-zinc-500 transition-all duration-200 hover:border-white/[0.12] focus-visible:outline-none focus-visible:border-teal-500/40 focus-visible:ring-2 focus-visible:ring-teal-500/20 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0f] focus-visible:bg-white/[0.05] disabled:cursor-not-allowed disabled:opacity-40',
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';
