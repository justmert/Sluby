import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Film, Search } from 'lucide-react';
import { PageContainer, PageHeader } from '@/components/layout/PageContainer';
import { AssetPlayer } from '@/components/asset/AssetPlayer';
import { AssetThumbnail } from '@/components/asset/AssetThumbnail';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Skeleton } from '@/components/ui/skeleton';
import { useAssetById, useAssetList } from '@/hooks/asset-queries';
import { useDebounce } from '@/hooks/useDebounce';
import { formatDuration } from '@/lib/formatters';
import { cn } from '@/lib/utils';

/** Pick any ready video and play it the way an embedding app would. */
export default function PlayerPage() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('asset') ?? undefined;
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search.trim(), 300);
  const list = useAssetList({ status: 'ready', limit: 50, search: debounced || undefined });
  const selected = useAssetById(selectedId);
  const assets = list.data?.data ?? [];

  return (
    <PageContainer>
      <PageHeader
        title="Player"
        description="Preview any ready video with @sluby/player, the same component apps embed"
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent>
            {!selectedId ? (
              <Empty className="aspect-video">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Film />
                  </EmptyMedia>
                  <EmptyTitle>Pick a video</EmptyTitle>
                  <EmptyDescription>
                    Choose a ready video from the list to play it.
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : selected.isLoading ? (
              <Skeleton className="aspect-video w-full" />
            ) : selected.data ? (
              <div className="flex flex-col gap-3">
                <AssetPlayer
                  key={selected.data.id}
                  assetId={selected.data.id}
                  signed={selected.data.accessTier === 'private'}
                />
                <div className="flex items-center justify-between gap-4">
                  <p className="truncate font-medium">{selected.data.title}</p>
                  <Button variant="outline" size="sm" asChild>
                    <Link to={`/studio/assets/${selected.data.id}`}>Asset details</Link>
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-destructive">
                Could not load this video: {selected.error?.message}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Ready videos</CardTitle>
            <CardDescription>{list.data ? `${list.data.total} playable` : ' '}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <InputGroup>
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                placeholder="Search"
                aria-label="Search ready videos"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </InputGroup>
            <ul className="flex max-h-[60vh] flex-col gap-1 overflow-y-auto">
              {list.isLoading &&
                Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-14" />)}
              {assets.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => setParams({ asset: a.id })}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md p-2 text-left transition-colors hover:bg-muted',
                      a.id === selectedId && 'bg-muted',
                    )}
                  >
                    <AssetThumbnail
                      thumbnailObjectIds={a.thumbnailObjectIds}
                      title={a.title}
                      className="w-16"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{a.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {formatDuration(a.durationMs)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
              {list.data && assets.length === 0 && (
                <p className="text-sm text-muted-foreground">No ready videos match.</p>
              )}
            </ul>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
