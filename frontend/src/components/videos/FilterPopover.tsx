import { ListFilter } from 'lucide-react';
import type { AccessTier, VideoAssetStatus } from '@sluby/sdk';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ACCESS_FILTERS, ALL, STATUS_FILTERS } from './filters';

export interface FilterPopoverProps {
  status: VideoAssetStatus | undefined;
  tier: AccessTier | undefined;
  onStatusChange: (status: VideoAssetStatus | undefined) => void;
  onTierChange: (tier: AccessTier | undefined) => void;
  className?: string;
}

/**
 * Status and access in one Filter button, for narrow screens where two
 * selects beside the search would wrap the toolbar onto four rows (RDS-09).
 * The count says how many filters are on.
 */
export function FilterPopover({
  status,
  tier,
  onStatusChange,
  onTierChange,
  className,
}: FilterPopoverProps) {
  const applied = (status ? 1 : 0) + (tier ? 1 : 0);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={className}
          aria-label={applied ? `Filter, ${applied} on` : 'Filter'}
        >
          <ListFilter />
          Filter
          {applied > 0 && (
            <Badge variant="secondary" className="tabular-nums" aria-hidden="true">
              {applied}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Status</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={status ?? ALL}
          onValueChange={(v) => onStatusChange(v === ALL ? undefined : (v as VideoAssetStatus))}
        >
          <DropdownMenuRadioItem value={ALL}>All statuses</DropdownMenuRadioItem>
          {STATUS_FILTERS.map((s) => (
            <DropdownMenuRadioItem key={s.value} value={s.value}>
              {s.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Access</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={tier ?? ALL}
          onValueChange={(v) => onTierChange(v === ALL ? undefined : (v as AccessTier))}
        >
          <DropdownMenuRadioItem value={ALL}>All access</DropdownMenuRadioItem>
          {ACCESS_FILTERS.map((a) => (
            <DropdownMenuRadioItem key={a.value} value={a.value}>
              {a.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
