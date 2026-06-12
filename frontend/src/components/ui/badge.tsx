import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium tracking-wide transition-colors duration-200',
  {
    variants: {
      variant: {
        default:
          'bg-teal-500/10 text-teal-400 border border-teal-500/20',
        secondary:
          'bg-white/[0.05] text-zinc-300 border border-white/[0.08]',
        destructive:
          'bg-red-500/10 text-red-400 border border-red-500/20',
        outline:
          'text-zinc-400 border border-white/[0.08]',
        success:
          'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
        warning:
          'bg-amber-500/10 text-amber-400 border border-amber-500/20',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
