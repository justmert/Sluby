import { CircleHelp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { formatBytes } from '@/lib/formatters';
import { SECTOR_BYTES } from '@/lib/sia';

export interface SiaStorageExplainerProps {
  /** Shard counts as the API reports them; null when slabs were not described or disagree. */
  dataShards: number | null;
  parityShards: number | null;
}

/**
 * "What do these numbers mean?": one plain line per Sia term on the storage
 * tab, so the tab can keep the real words (copy proposal P2). The shard
 * counts come from the API, never a constant.
 */
export function SiaStorageExplainer({ dataShards, parityShards }: SiaStorageExplainerProps) {
  const shards =
    dataShards !== null && parityShards !== null
      ? `Any ${dataShards} of its ${dataShards + parityShards} shards rebuild it, so the video survives hosts going offline.`
      : 'A few of its shards are enough to rebuild it, so the video survives hosts going offline.';
  const terms: Array<[string, string]> = [
    ['Slab', 'A fixed-size block that files are packed into before Sia splits it up.'],
    ['Shard', `One of the pieces a slab is split into. ${shards}`],
    ['Sector', `The piece of one shard that one host stores, about ${formatBytes(SECTOR_BYTES)}.`],
    ['Padding', 'Empty space in a slab that small files did not fill.'],
    ['File contract', 'The on-chain agreement that pays a host to keep its sectors.'],
  ];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="link" size="sm" className="h-auto px-0">
          <CircleHelp aria-hidden="true" />
          What do these numbers mean?
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        <dl className="flex flex-col gap-2.5 text-sm">
          {terms.map(([term, meaning]) => (
            <div key={term}>
              <dt className="font-medium">{term}</dt>
              <dd className="text-muted-foreground">{meaning}</dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}
