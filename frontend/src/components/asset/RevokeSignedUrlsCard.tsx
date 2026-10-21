import { useState } from 'react';
import type { VideoAsset } from '@sluby/sdk';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { useRevokeSignedUrls } from '@/hooks/asset-detail-queries';
import { toastSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';

type Asset = Pick<VideoAsset, 'id' | 'accessTier'>;

// what a revoke does depends on the tier: a private video's files need a
// signature, so every signed url stops and players fetching through this
// server are refused; a public video's files are open, so only the entry of
// its signed playback ids is gated and players already playing go on
const CONSEQUENCE: Record<VideoAsset['accessTier'], string> = {
  private:
    'Every signed URL given out for this video stops working within a minute, including the links of its signed playback IDs. A player using one through this server stops once it has played what it already loaded; one streaming straight from Sia keeps playing until its share links expire, at most an hour. The video stays private, and signed URLs created after this work. This cannot be undone.',
  public:
    'Signed URLs given out for the signed playback IDs of this video stop working at once, so a player needs a new one to start. A player already playing is not cut off, since the video’s files are public. Public links and embeds keep working, and the video stays public. This cannot be undone.',
};

export interface RevokeSignedUrlsCardProps {
  asset: Asset;
  /** the revoke went through: a player on this page holding a signed URL needs a new one */
  onRevoked?: () => void;
  className?: string;
}

/**
 * Stops the signed URLs of one video handed out so far, for a link that
 * leaked, without changing who can watch it.
 */
export function RevokeSignedUrlsCard({ asset, onRevoked, className }: RevokeSignedUrlsCardProps) {
  const revoke = useRevokeSignedUrls(asset.id);
  const [confirming, setConfirming] = useState<Asset | null>(null);

  return (
    <section
      aria-labelledby="revoke-signed-heading"
      className={cn('flex flex-col gap-2', className)}
    >
      <h2 id="revoke-signed-heading" className="font-heading text-heading">
        Signed URLs
      </h2>
      <p className="text-muted-foreground">
        Stop the signed URLs given out so far without changing who can watch.
      </p>
      <Button
        variant="outline"
        className="self-start"
        disabled={revoke.isPending}
        onClick={() => setConfirming(asset)}
      >
        Revoke signed URLs
      </Button>

      <ConfirmDialog
        item={confirming}
        onClose={() => setConfirming(null)}
        title="Revoke signed URLs?"
        description={(v) => CONSEQUENCE[v.accessTier]}
        confirmLabel="Revoke"
        pendingLabel="Revoking…"
        errorTitle="Could not revoke the signed URLs"
        onConfirm={async () => {
          await revoke.mutateAsync();
          toastSuccess('Signed URLs revoked');
          onRevoked?.();
        }}
      />
    </section>
  );
}
