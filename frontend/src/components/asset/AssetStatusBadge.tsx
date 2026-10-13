import type { VideoAssetStatus } from '@sluby/sdk';
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

export function AssetStatusBadge({ status }: { status: VideoAssetStatus }) {
  const c = CONFIG[status] ?? { label: status, variant: 'secondary' as const };
  return (
    <Badge variant={c.variant}>
      {c.busy && <Spinner data-icon="inline-start" aria-hidden="true" />}
      {c.label}
    </Badge>
  );
}
