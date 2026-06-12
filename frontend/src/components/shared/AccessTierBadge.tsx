import { Globe, Lock } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { AccessTier } from '@/types/assets';

export interface AccessTierBadgeProps {
  tier: AccessTier;
  className?: string;
}

const tierConfig: Record<
  AccessTier,
  {
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    className: string;
  }
> = {
  public: {
    label: 'Public',
    icon: Globe,
    className:
      'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  },
  private: {
    label: 'Private',
    icon: Lock,
    className:
      'bg-violet-500/10 text-violet-400 border-violet-500/20',
  },
};

export function AccessTierBadge({ tier, className }: AccessTierBadgeProps) {
  const config = tierConfig[tier];
  const Icon = config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium tracking-wide border transition-colors duration-200',
        config.className,
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {config.label}
    </span>
  );
}
