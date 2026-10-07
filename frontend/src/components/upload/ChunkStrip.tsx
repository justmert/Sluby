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

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1" aria-hidden="true">
        {fills.map((fill, i) => (
          <div key={i} className="relative h-3 w-3 overflow-hidden rounded-[3px] bg-muted">
            <div
              className={cn(
                'absolute inset-y-0 left-0 bg-primary transition-[width] duration-300',
                active && fill > 0 && fill < 1 && 'animate-pulse',
              )}
              style={{ width: `${fill * 100}%` }}
            />
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {done} of {chunks} chunk{chunks === 1 ? '' : 's'}
        {perCell > 1 && `, ${perCell} chunks per cell`}
      </p>
    </div>
  );
}
