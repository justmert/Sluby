import { useRef, useState } from 'react';
import {
  SlubyPlayer,
  type HybridDeliveryStats,
  type QualityLevel,
  type SlubyPlayerHandle,
} from '@sluby/player';
import { SlubyError } from '@sluby/sdk';
import { InlineError } from '@/components/shared/InlineError';
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

// the board's pill on the video: white text and a light edge over the frame,
// which stays dark in both themes
const PILL =
  'h-6 rounded-full border border-white/35 bg-black/45 px-2 text-xs font-semibold text-white backdrop-blur-sm';

const describe = (level: QualityLevel) =>
  `${level.name} (${formatResolution(level.width, level.height)}, ${formatBitrate(level.bitrate)})`;

type Delivery = 'sia' | 'hybrid' | 'gateway';

/**
 * The pill's words. The video always comes from Sia; what differs is whether
 * this server relays the bytes or the browser reads them from the hosts.
 */
function deliveryLabel(delivery: Delivery, stats: HybridDeliveryStats | null): string {
  if (delivery === 'sia') return 'From Sia, direct';
  if (delivery === 'gateway') return 'From Sia via this server';
  const total = stats ? stats.siaBytes + stats.gatewayBytes : 0;
  // the start always plays through the server, so there is nothing to split yet
  if (!stats || total === 0) return 'From Sia, starting via this server';
  return `From Sia, ${Math.round((stats.siaBytes / total) * 100)}% direct`;
}

// measured on a 10 second video from a home connection: with 5 s buffered
// and 2 s kept in hand, about a third came straight from Sia in every run and
// no read fell back; the package defaults (10 s and 4 s) leave short videos
// entirely to this server
const STUDIO_HYBRID_POLICY = { minBufferSec: 5, safetyMarginSec: 2 };

/**
 * The Studio's preview: @sluby/player driven by the same sdk client in the
 * board's 16:9 frame, with hybrid delivery so a video starts through this
 * server and the rest streams from Sia. Where the bytes come from and the
 * quality picker sit on the frame's top edge, clear of the player's controls.
 */
export function AssetPlayer({ assetId, signed, title }: AssetPlayerProps) {
  const player = useRef<SlubyPlayerHandle>(null);
  const [levels, setLevels] = useState<QualityLevel[]>([]);
  const [current, setCurrent] = useState<QualityLevel | null>(null);
  const [pinned, setPinned] = useState<string>(AUTO);
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [deliveryStats, setDeliveryStats] = useState<HybridDeliveryStats | null>(null);
  const [error, setError] = useState<unknown>(null);

  const choose = (value: string) => {
    setPinned(value);
    player.current?.setQuality(value === AUTO ? -1 : Number(value));
  };

  return (
    <div className="flex flex-col gap-3">
      {/* the frame clips the video's own focus ring, so the frame draws one */}
      <div className="relative overflow-hidden rounded-xl bg-media outline-offset-2 has-[video:focus-visible]:outline-2 has-[video:focus-visible]:outline-ring [&_video]:outline-none">
        <SlubyPlayer
          ref={player}
          client={sluby}
          assetId={assetId}
          signed={signed}
          expiresIn={signed ? 3600 : undefined}
          title={title}
          siaDelivery="hybrid"
          hybridPolicy={STUDIO_HYBRID_POLICY}
          controls
          className="aspect-video w-full"
          style={{ width: '100%', aspectRatio: '16 / 9' }}
          onQualitiesChange={(next) => {
            setLevels(next);
            setPinned(AUTO);
          }}
          onQualityChange={setCurrent}
          onDeliveryChange={(next) => {
            setDelivery(next);
            setDeliveryStats(null);
          }}
          onDeliveryStats={setDeliveryStats}
          onError={(e) => setError(playbackError(e))}
          onReady={() => setError(null)}
        />
        {(levels.length > 0 || delivery) && (
          <div className="absolute top-3 right-3 flex animate-enter items-center gap-2">
            {levels.length > 0 && (
              <select
                aria-label="Quality"
                value={pinned}
                onChange={(e) => choose(e.target.value)}
                className={`${PILL} cursor-pointer [&>option]:bg-card [&>option]:text-foreground`}
              >
                <option value={AUTO}>
                  Auto{current && pinned === AUTO ? ` (${current.name})` : ''}
                </option>
                {levels.map((level) => (
                  <option key={level.index} value={String(level.index)} title={describe(level)}>
                    {level.name}
                  </option>
                ))}
              </select>
            )}
            {delivery && (
              <span className={`${PILL} inline-flex items-center`}>
                {deliveryLabel(delivery, deliveryStats)}
              </span>
            )}
          </div>
        )}
      </div>
      {/* what is playing, for screen readers; the picker shows it to the eye */}
      <p className="sr-only" aria-live="polite">
        {current &&
          `Playing ${describe(current)}${pinned === AUTO ? ', picked automatically' : ''}`}
      </p>
      <InlineError title="Could not play this video" error={error} />
    </div>
  );
}
