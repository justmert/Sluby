import { cn } from '@/lib/utils';
import { chunkProgress } from './chunk-progress';

interface ChunkStripProps {
  bytesUploaded: number;
  bytesTotal: number;
  chunkSize: number;
  active: boolean;
}

export function ChunkStrip({ bytesUploaded, bytesTotal, chunkSize, active }: ChunkStripProps) {
  const { chunks, perCell, fills, done } = chunkProgress(bytesUploaded, bytesTotal, chunkSize);
  // only the cell being sent moves; the rest stay still so the strip reads calmly
  const sending = active ? fills.findIndex((f) => f < 1) : -1;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1" aria-hidden="true">
        {fills.map((fill, i) => (
          <div
            key={i}
            data-sending={i === sending || undefined}
            className={cn(
              'relative h-3 w-3 overflow-hidden rounded-[3px] bg-muted',
              i === sending &&
                'before:absolute before:inset-0 before:z-10 before:-translate-x-full before:bg-linear-to-r before:from-transparent before:via-foreground/25 before:to-transparent motion-safe:before:animate-shimmer motion-reduce:before:hidden',
            )}
          >
            <div
              className="absolute inset-0 origin-left bg-primary transition-transform duration-300 ease-out-soft"
              style={{ transform: `scaleX(${fill})` }}
            />
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">
        {done} of {chunks} chunk{chunks === 1 ? '' : 's'}
        {perCell > 1 && `, ${perCell} chunks per cell`}
      </p>
    </div>
  );
}
