import type { VideoAssetStatus } from '@sluby/sdk';
import { StatusBadge } from '@/components/shared/StatusBadge';

/**
 * A video's status. A thin wrapper over StatusBadge kind="asset", so the label
 * and tone come from the one mapping in components/shared/status.ts. `live`
 * announces changes and uses a spinner; give it to one badge per page. Rows
 * in a list get the calmer pulsing dot.
 */
export function AssetStatusBadge({
  status,
  live = false,
}: {
  status: VideoAssetStatus;
  live?: boolean;
}) {
  return <StatusBadge kind="asset" status={status} live={live} busy={live ? 'spinner' : 'dot'} />;
}
