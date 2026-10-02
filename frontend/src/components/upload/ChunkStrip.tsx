import { cn } from '@/lib/utils';

const MAX_CELLS = 96;

interface ChunkStripProps {
  bytesUploaded: number;
  bytesTotal: number;
  chunkSize: number;
  active: boolean;
}

/**
 * The file as the tus chunks it is sent in. Large files group several chunks
 * per cell so the strip stays readable; the caption says how many.
 */
export function chunkProgress(bytesUploaded: number, bytesTotal: number, chunkSize: number) {
  const chunks = Math.max(1, Math.ceil(bytesTotal / chunkSize));
  const perCell = Math.ceil(chunks / MAX_CELLS);
  const cells = Math.ceil(chunks / perCell);
  // the last chunk is usually short, so measure fill against real byte ranges
  const fills = Array.from({ length: cells }, (_, i) => {
    const from = i * perCell * chunkSize;
    const to = Math.min(bytesTotal, (i + 1) * perCell * chunkSize);
    return to > from ? Math.min(1, Math.max(0, (bytesUploaded - from) / (to - from))) : 0;
  });
  const done =
    bytesUploaded >= bytesTotal ? chunks : Math.min(chunks, Math.floor(bytesUploaded / chunkSize));
  return { chunks, perCell, fills, done };
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
