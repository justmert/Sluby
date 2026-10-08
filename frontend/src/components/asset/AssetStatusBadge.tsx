import type { VideoAssetStatus } from '@sluby/sdk';
import { StatusTransition } from '@/components/motion';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';

const CONFIG: Record<
  VideoAssetStatus,
  { label: string; variant: 'secondary' | 'warning' | 'success' | 'destructive'; busy?: boolean }
> = {
  created: { label: 'Created', variant: 'secondary' },
  uploading: { label: 'Uploading', variant: 'warning', busy: true },
  processing: { label: 'Processing', variant: 'warning', busy: true },
  ready: { label: 'Ready', variant: 'success' },
  failed: { label: 'Failed', variant: 'destructive' },
};

/**
 * The asset's status as a badge that crossfades when a poll moves it on.
 * `live` announces changes; give it to one badge per page, not every row.
 */
export function AssetStatusBadge({
  status,
  live = false,
}: {
  status: VideoAssetStatus;
  live?: boolean;
}) {
  const c = CONFIG[status] ?? { label: status, variant: 'secondary' as const };
  return (
    <StatusTransition status={status} live={live}>
      <Badge variant={c.variant}>
        {c.busy && <Spinner data-icon="inline-start" aria-hidden="true" />}
        {c.label}
      </Badge>
    </StatusTransition>
  );
}
