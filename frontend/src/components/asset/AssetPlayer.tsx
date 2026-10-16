import { useRef, useState } from 'react';
import { Cloud, Server } from 'lucide-react';
import { SlubyPlayer, type QualityLevel, type SlubyPlayerHandle } from '@sluby/player';
import { Badge } from '@/components/ui/badge';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { formatBitrate } from '@/lib/formatters';
import { sluby } from '@/lib/sluby';

const AUTO = 'auto';

interface AssetPlayerProps {
  assetId: string;
  /** Private assets play through a signed, expiring url. */
  signed: boolean;
}

/**
 * The studio's preview: @sluby/player driven by the same sdk client, with a
 * rendition picker on top of the player's own quality api.
 */
export function AssetPlayer({ assetId, signed }: AssetPlayerProps) {
  const player = useRef<SlubyPlayerHandle>(null);
  const [levels, setLevels] = useState<QualityLevel[]>([]);
  const [current, setCurrent] = useState<QualityLevel | null>(null);
  const [pinned, setPinned] = useState<string>(AUTO);
  const [delivery, setDelivery] = useState<'sia' | 'gateway' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = (value: string) => {
    if (!value) return;
    setPinned(value);
    player.current?.setQuality(value === AUTO ? -1 : Number(value));
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-lg bg-black">
        <SlubyPlayer
          ref={player}
          client={sluby}
          assetId={assetId}
          signed={signed}
          expiresIn={signed ? 3600 : undefined}
          controls
          className="aspect-video w-full"
          style={{ width: '100%', aspectRatio: '16 / 9' }}
          onQualitiesChange={(next) => {
            setLevels(next);
            setPinned(AUTO);
          }}
          onQualityChange={setCurrent}
          onDeliveryChange={setDelivery}
          onError={(e) => setError(e.message)}
          onReady={() => setError(null)}
        />
      </div>

      {/* the row fills in as the player learns its levels and delivery; its
          height is held from the start so the page below does not move */}
      <div className="flex min-h-8 flex-wrap items-center gap-3">
        {levels.length > 0 && (
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={pinned}
            onValueChange={choose}
            aria-label="Rendition"
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
            {delivery === 'sia' ? 'Streaming direct from Sia' : 'Streaming via gateway'}
          </Badge>
        )}
      </div>
      {/* what is playing gets its own line, held open from the start */}
      <p className="min-h-5 text-sm text-muted-foreground" aria-live="polite">
        {current && (
          <span className="animate-in duration-200 fade-in">
            Playing {current.name} ({current.width}x{current.height},{' '}
            {formatBitrate(current.bitrate)}){pinned === AUTO && ', chosen adaptively'}
          </span>
        )}
      </p>
      {error && <p className="text-sm text-destructive">Playback error: {error}</p>}
    </div>
  );
}
