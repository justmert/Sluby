import { useRef, useState } from 'react';
import { Cloud, Server } from 'lucide-react';
import { SlubyPlayer, type QualityLevel, type SlubyPlayerHandle } from '@sluby/player';
import { SlubyError } from '@sluby/sdk';
import { InlineError } from '@/components/shared/InlineError';
import { Badge } from '@/components/ui/badge';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { formatBitrate, formatResolution } from '@/lib/formatters';
import { sluby } from '@/lib/sluby';

const AUTO = 'auto';

interface AssetPlayerProps {
  assetId: string;
  /** Private videos play through a signed, expiring URL. */
  signed: boolean;
  /** The video's title, for the player's accessible name. */
  title?: string;
}

/**
 * The error to explain: the API's own error when the player got one (a 409
 * for a video still processing, a 502 from the share map), otherwise the
 * player's, whose raw text only goes under Details.
 */
function playbackError(err: Error): unknown {
  return err.cause instanceof SlubyError ? err.cause : err;
}

/**
 * The Studio's preview: @sluby/player driven by the same sdk client, with a
 * quality picker on top of the player's own quality api.
 */
export function AssetPlayer({ assetId, signed, title }: AssetPlayerProps) {
  const player = useRef<SlubyPlayerHandle>(null);
  const [levels, setLevels] = useState<QualityLevel[]>([]);
  const [current, setCurrent] = useState<QualityLevel | null>(null);
  const [pinned, setPinned] = useState<string>(AUTO);
  const [delivery, setDelivery] = useState<'sia' | 'gateway' | null>(null);
  const [error, setError] = useState<unknown>(null);

  const choose = (value: string) => {
    if (!value) return;
    setPinned(value);
    player.current?.setQuality(value === AUTO ? -1 : Number(value));
  };

  return (
    <div className="flex flex-col gap-3">
      {/* the frame clips the video's own focus ring, so the frame draws one */}
      <div className="overflow-hidden rounded-lg bg-black outline-offset-2 has-[video:focus-visible]:outline-2 has-[video:focus-visible]:outline-ring [&_video]:outline-none">
        <SlubyPlayer
          ref={player}
          client={sluby}
          assetId={assetId}
          signed={signed}
          expiresIn={signed ? 3600 : undefined}
          title={title}
          controls
          className="aspect-video w-full"
          style={{ width: '100%', aspectRatio: '16 / 9' }}
          onQualitiesChange={(next) => {
            setLevels(next);
            setPinned(AUTO);
          }}
          onQualityChange={setCurrent}
          onDeliveryChange={setDelivery}
          onError={(e) => setError(playbackError(e))}
          onReady={() => setError(null)}
        />
      </div>

      {/* the row fills in as the player learns its levels and delivery; its
          height is held from the start so the page below does not move */}
      <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2">
        {levels.length > 0 && (
          <ToggleGroup
            type="single"
            variant="segmented"
            size="sm"
            value={pinned}
            onValueChange={choose}
            aria-label="Quality"
            // wraps when the text is large, so no quality is cut off on a phone (A11Y-46)
            className="flex-wrap data-[variant=segmented]:h-auto"
          >
            <ToggleGroupItem value={AUTO}>Auto</ToggleGroupItem>
            {levels.map((level) => (
              <ToggleGroupItem
                key={level.index}
                value={String(level.index)}
                title={formatBitrate(level.bitrate)}
              >
                {level.name}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
        {delivery && (
          <Badge variant="outline" className="ml-auto animate-in duration-200 fade-in">
            {delivery === 'sia' ? <Cloud /> : <Server />}
            {delivery === 'sia' ? 'Streaming from Sia' : 'Streaming through this server'}
          </Badge>
        )}
      </div>
      {/* what is playing gets its own line, held open from the start */}
      <p className="min-h-5 text-sm text-muted-foreground tabular-nums" aria-live="polite">
        {current && (
          <span className="animate-in duration-200 fade-in">
            Playing {current.name} ({formatResolution(current.width, current.height)},{' '}
            {formatBitrate(current.bitrate)}){pinned === AUTO && ', picked automatically'}
          </span>
        )}
      </p>
      <InlineError title="Could not play this video" error={error} />
    </div>
  );
}
