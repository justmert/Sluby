import { useState, type ComponentProps } from 'react';
import type { RetryStage, VideoAsset } from '@sluby/sdk';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useRetryProcessing } from '@/hooks/asset-queries';
import { withLead } from '@/lib/errors';
import { Icons } from '@/lib/icons';
import { toastError, toastSuccess } from '@/lib/toast';
import { restartedMessage } from './processing';

export interface RetryProcessingButtonProps extends Pick<
  ComponentProps<typeof Button>,
  'variant' | 'size' | 'className'
> {
  asset: Pick<VideoAsset, 'id' | 'title'>;
  /** Put the title in the success toast, for lists where several videos show. */
  named?: boolean;
  /**
   * A short "Retry" button whose accessible name still says which video:
   * "Retry processing {title}". `labelClassName` can hide the word on narrow rows.
   */
  compact?: boolean;
  labelClassName?: string;
  /**
   * Run the retry another way, such as the upload store, which shows the
   * outcome on its own row. Resolve with the stage to get the success toast,
   * or with nothing to leave the result to the caller. Rejections get the
   * error toast. Without it the button calls POST /assets/{id}/retry.
   */
  onRetry?: () => Promise<{ stage: RetryStage } | void>;
  onRetried?: (stage: RetryStage | null) => void;
}

/**
 * Restart processing of a failed video. Only offer it when failureInfo says
 * retrying can help (action "retry"); for an unreadable file, offer a new
 * upload instead (FLW-22).
 */
export function RetryProcessingButton({
  asset,
  named = false,
  compact = false,
  labelClassName,
  onRetry,
  onRetried,
  variant,
  size,
  className,
}: RetryProcessingButtonProps) {
  const retry = useRetryProcessing();
  // its own flag, so a retry through onRetry shows as busy too
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      const result = onRetry ? await onRetry() : await retry.mutateAsync(asset.id);
      if (result) toastSuccess(restartedMessage(result.stage, named ? asset.title : undefined));
      onRetried?.(result ? result.stage : null);
    } catch (err) {
      toastError(withLead('Could not retry', err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      disabled={busy}
      aria-busy={busy || undefined}
      aria-label={compact ? `Retry processing ${asset.title}` : undefined}
      onClick={() => void run()}
    >
      {busy ? (
        <Spinner aria-hidden="true" role={undefined} aria-label={undefined} />
      ) : (
        <Icons.retry />
      )}
      <span className={labelClassName}>{compact ? 'Retry' : 'Retry processing'}</span>
    </Button>
  );
}
