import { useState } from 'react';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { ObjectIdBadge } from '@/components/shared/ObjectIdBadge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ObjectRole, SiaStorageInfo } from '@/hooks/asset-detail-queries';
import { formatBytes } from '@/lib/formatters';
import { EXTERNAL_LINK_PROPS, explorerFor } from '@/lib/sia-explorer';

const ROLE_LABELS: Record<ObjectRole, string> = {
  master_manifest: 'Master playlist',
  variant_playlist: 'Variant playlist',
  rendition_data: 'Media',
  thumbnail: 'Thumbnail',
};

const HOSTS_SHOWN = 12;

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

function shortKey(key: string): string {
  const raw = key.replace(/^ed25519:/, '');
  return raw.length > 16 ? `${raw.slice(0, 8)}...${raw.slice(-6)}` : raw;
}

export function SiaStorageBreakdown({
  info,
  isLoading,
  error,
}: {
  info?: SiaStorageInfo;
  isLoading: boolean;
  error: Error | null;
}) {
  const [showAllHosts, setShowAllHosts] = useState(false);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Sia storage</CardTitle>
          <CardDescription>Asking the indexer about every object...</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-48 w-full" />
        </CardContent>
      </Card>
    );
  }
  if (error || !info) {
    return (
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertTitle>Could not load the Sia breakdown</AlertTitle>
        <AlertDescription>{error?.message ?? 'No data'}</AlertDescription>
      </Alert>
    );
  }

  const t = info.totals;
  const explorer = explorerFor(info.indexer.network);
  const hosts = showAllHosts ? info.hosts : info.hosts.slice(0, HOSTS_SHOWN);
  const maxCountrySectors = Math.max(1, ...info.countries.map((c) => c.sectors));

  return (
    <div className="flex flex-col gap-4">
      {info.unavailable_object_ids.length > 0 && (
        <Alert>
          <AlertTriangle />
          <AlertTitle>
            The indexer did not describe {info.unavailable_object_ids.length} of {t.object_count}{' '}
            objects
          </AlertTitle>
          <AlertDescription>
            Totals below cover only the objects it answered for. Reload to ask again.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Sia storage</CardTitle>
          <CardDescription>
            Live from the indexer at {info.indexer.url} ({info.indexer.network})
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Objects" value={t.object_count} />
          <Stat label="Stored" value={formatBytes(t.raw_bytes)} hint="Before erasure coding" />
          <Stat label="Encoded" value={formatBytes(t.encoded_bytes)} hint="After erasure coding" />
          <Stat
            label="Redundancy"
            value={t.redundancy_ratio !== null ? `${t.redundancy_ratio.toFixed(1)}x` : 'mixed'}
            hint={
              t.data_shards !== null
                ? `${t.data_shards} data + ${t.parity_shards} parity shards`
                : 'Slabs use different shard configs'
            }
          />
          <Stat label="Slabs" value={t.unique_slab_count} hint="Shared slabs counted once" />
          <Stat label="Sectors" value={t.unique_sector_count} hint="4 MiB each on a host" />
          <Stat label="Hosts" value={t.host_count} />
          <Stat label="Countries" value={t.country_count} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Objects</CardTitle>
          <CardDescription>
            Every Sia object behind this video. Objects uploaded together share slabs.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Object</TableHead>
                <TableHead>Object ID</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead className="text-right">Slabs</TableHead>
                <TableHead className="text-right">Sectors</TableHead>
                <TableHead className="pr-4 text-right">Hosts</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {info.objects.map((o) => (
                <TableRow key={o.object_id}>
                  <TableCell className="pl-4">
                    <span className="font-medium">{o.role ? ROLE_LABELS[o.role] : 'Object'}</span>
                    {o.rendition && (
                      <span className="ml-1.5 text-muted-foreground">{o.rendition}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <ObjectIdBadge value={o.object_id} truncate={6} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatBytes(o.size)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {o.slab_count}
                    {o.shared_slab_count > 0 && (
                      <Badge
                        variant="secondary"
                        className="ml-1.5"
                        title="Slabs shared with other objects of this video"
                      >
                        {o.shared_slab_count} shared
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{o.sector_count}</TableCell>
                  <TableCell className="pr-4 text-right tabular-nums">{o.host_count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Host distribution</CardTitle>
            <CardDescription>
              Sectors per host, each shared slab counted once. Links open {explorer.label}.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {hosts.map((h) => (
              <div key={h.public_key} className="flex items-center justify-between gap-3 text-sm">
                <a
                  href={explorer.host(h.public_key)}
                  {...EXTERNAL_LINK_PROPS}
                  className="flex min-w-0 items-center gap-1.5 font-mono text-xs hover:underline"
                  title={h.public_key}
                >
                  {shortKey(h.public_key)}
                  <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
                </a>
                <span className="flex items-center gap-3 text-muted-foreground">
                  <span>{h.country_code ? countryName(h.country_code) : 'unknown'}</span>
                  <span className="w-16 text-right tabular-nums">
                    {h.sectors} sector{h.sectors === 1 ? '' : 's'}
                  </span>
                </span>
              </div>
            ))}
            {info.hosts.length > HOSTS_SHOWN && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 self-start"
                onClick={() => setShowAllHosts((v) => !v)}
              >
                {showAllHosts ? 'Show fewer' : `Show all ${info.hosts.length} hosts`}
              </Button>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Countries</CardTitle>
            <CardDescription>Where the sectors of this video live</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {info.countries.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                The indexer did not report host locations.
              </p>
            ) : (
              info.countries.map((c) => (
                <div key={c.country_code} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-sm">
                    <span>{countryName(c.country_code)}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {c.sectors} sectors, {c.hosts} host{c.hosts === 1 ? '' : 's'}
                    </span>
                  </div>
                  <Progress
                    value={(c.sectors / maxCountrySectors) * 100}
                    aria-label={`${countryName(c.country_code)} share`}
                  />
                </div>
              ))
            )}
            {info.hosts.some((h) => !h.country_code) && (
              <p className="text-xs text-muted-foreground">
                Unknown means the host is not in the host list the indexer returns, so its
                location was not reported.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {(info.contracts || info.indexer.wallet_address) && (
        <Card>
          <CardHeader>
            <CardTitle>On-chain</CardTitle>
            <CardDescription>
              File contracts and wallet, verifiable on {explorer.label}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            {info.indexer.wallet_address && (
              <a
                href={explorer.address(info.indexer.wallet_address)}
                {...EXTERNAL_LINK_PROPS}
                className="flex items-center gap-1.5 font-mono text-xs hover:underline"
              >
                Wallet {shortKey(info.indexer.wallet_address)}
                <ExternalLink className="size-3" />
              </a>
            )}
            {info.contracts && (
              <div className="flex flex-wrap gap-2">
                {info.contracts.map((id) => (
                  <a
                    key={id}
                    href={explorer.contract(id)}
                    {...EXTERNAL_LINK_PROPS}
                    className="font-mono text-xs hover:underline"
                  >
                    {shortKey(id)}
                  </a>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
