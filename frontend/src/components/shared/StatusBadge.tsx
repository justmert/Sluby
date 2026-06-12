import { Upload, Loader2, Check, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { VideoStatus } from '@/types/assets';

export interface StatusBadgeProps {
  status: VideoStatus;
  className?: string;
}

const statusConfig: Record<
  VideoStatus,
  {
    label: string;
    className: string;
    icon?: React.ComponentType<{ className?: string }>;
    iconClassName?: string;
  }
> = {
  created: {
    label: 'Created',
    className: 'bg-white/[0.05] text-zinc-400 border-white/[0.08]',
  },
  uploading: {
    label: 'Uploading',
    className: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    icon: Upload,
  },
  processing: {
    label: 'Processing',
    className: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
    icon: Loader2,
    iconClassName: 'animate-spin',
  },
  ready: {
    label: 'Ready',
    className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    icon: Check,
  },
  failed: {
    label: 'Failed',
    className: 'bg-red-500/10 text-red-400 border-red-500/20',
    icon: X,
  },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium tracking-wide border transition-colors duration-200',
        config.className,
        className,
      )}
    >
      {Icon && (
        <Icon className={cn('h-3 w-3', config.iconClassName)} />
      )}
      {config.label}
    </span>
  );
}
