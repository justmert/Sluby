import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { DataTable } from '@/components/shared/DataTable';
import { InlineError } from '@/components/shared/InlineError';
import { ObjectIdBadge } from '@/components/shared/ObjectIdBadge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapse } from '@/components/motion';
import type { ObjectRole, SiaStorageInfo } from '@/hooks/asset-detail-queries';
import {
  formatBytes,
  formatCount,
  formatRatio,
  NO_VALUE,
  plural,
  truncateMiddle,
} from '@/lib/formatters';
import { SECTOR_BYTES, storageSummary } from '@/lib/sia';
import { EXTERNAL_LINK_PROPS, explorerFor } from '@/lib/sia-explorer';
import { SiaStorageExplainer } from './SiaStorageExplainer';

const ROLE_LABELS: Record<ObjectRole, string> = {
  master_manifest: 'Main playlist',
  variant_playlist: 'Playlist',
  rendition_data: 'Video',
  thumbnail: 'Thumbnail',
};

const HOSTS_SHOWN = 12;
const COUNTRIES_SHOWN = 8;

type SiaObject = SiaStorageInfo['objects'][number];

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-heading text-figure-sm tabular-nums">{value}</p>
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
  return truncateMiddle(key.replace(/^ed25519:/, ''), 8);
}

export function SiaStorageBreakdown({
  info,
  isLoading,
  error,
  onRetry,
  retrying = false,
}: {
  info?: SiaStorageInfo;
  isLoading: boolean;
  error: unknown;
  onRetry?: () => unknown;
  retrying?: boolean;
}) {
  const [showAllHosts, setShowAllHosts] = useState(false);
  const [showAllCountries, setShowAllCountries] = useState(false);

  if (isLoading) {
    // the same cards as the answer, so nothing below moves when it lands
    return (
      <div className="flex flex-col gap-4" data-testid="sia-storage-skeleton">
        <Card>
          <CardHeader>
            <CardTitle>Sia storage</CardTitle>
            <CardDescription>Loading storage details…</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-20 w-full rounded-lg" />
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Objects</CardTitle>
            <CardDescription>
              Every Sia object behind this video. Objects uploaded together share slabs.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>
    );
  }
  if (!info) {
    return (
      <InlineError
        title="Could not load Sia storage details"
        error={error ?? new Error('The server sent no storage details.')}
        onRetry={onRetry}
        retrying={retrying}
      />
    );
  }

  const t = info.totals;
  const explorer = explorerFor(info.indexer.network);
  const maxCountrySectors = Math.max(1, ...info.countries.map((c) => c.sectors));
  // shard counts are null both when no slab was described and when slabs disagree
  const described = t.unique_slab_count > 0;
  // a slab is filled up to data_shards sectors whatever the objects in it
  // hold, so small objects are mostly padding; say how much
  const padding =
    t.data_shards !== null && t.redundancy_ratio !== null
      ? Math.max(0, t.unique_slab_count * t.data_shards * SECTOR_BYTES - t.raw_bytes) *
        t.redundancy_ratio
      : null;

  return (
    <div className="flex flex-col gap-4">
      {info.unavailable_object_ids.length > 0 && (
        <Alert>
          <AlertTitle>
            The Sia indexer did not describe {formatCount(info.unavailable_object_ids.length)} of{' '}
            {plural(t.object_count, 'object')}
          </AlertTitle>
          <AlertDescription>
            The totals below cover only the objects it answered for. Reload to ask again.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Sia storage</CardTitle>
          <CardDescription className="flex flex-col items-start gap-1">
            <span>{storageSummary(t)}</span>
            <SiaStorageExplainer dataShards={t.data_shards} parityShards={t.parity_shards} />
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Objects" value={formatCount(t.object_count)} />
            <Stat label="Size" value={formatBytes(t.raw_bytes)} hint="Your files' size" />
            <Stat
              label="On Sia"
              value={formatBytes(t.encoded_bytes)}
              hint={
                padding !== null && padding > 0
                  ? `With redundancy and ${formatBytes(padding)} of padding`
                  : 'With redundancy, in whole slabs'
              }
            />
            <Stat
              label="Redundancy"
              value={
                t.redundancy_ratio !== null
                  ? formatRatio(t.redundancy_ratio)
                  : described
                    ? 'Mixed'
                    : NO_VALUE
              }
              hint={
                t.data_shards !== null && t.parity_shards !== null
                  ? `${formatCount(t.data_shards)} data + ${formatCount(t.parity_shards)} parity shards`
                  : described
                    ? 'Slabs use different shard counts'
                    : 'No slab was described'
              }
            />
            <Stat
              label="Slabs"
              value={formatCount(t.unique_slab_count)}
              hint="Shared slabs counted once"
            />
            <Stat
              label="Sectors"
              value={formatCount(t.unique_sector_count)}
              hint={`About ${formatBytes(SECTOR_BYTES)} each, on one host`}
            />
            <Stat label="Hosts" value={formatCount(t.host_count)} />
            <Stat label="Countries" value={formatCount(t.country_count)} />
          </div>
          <p className="text-xs text-muted-foreground">
            From the Sia indexer at {info.indexer.url} ({info.indexer.network})
          </p>
        </CardContent>
      </Card>

      <section aria-labelledby="sia-objects" className="flex flex-col gap-2">
        <div>
          <h2 id="sia-objects" className="font-heading text-heading">
            Objects
          </h2>
          <p className="text-sm text-muted-foreground">
            Every Sia object behind this video. Objects uploaded together share slabs.
          </p>
        </div>
        <DataTable<SiaObject>
          caption="Sia objects"
          rows={info.objects}
          getRowId={(o) => o.object_id}
          getRowLabel={(o) => (o.role ? ROLE_LABELS[o.role] : 'Object')}
          columns={[
            {
              id: 'object',
              header: 'Object',
              primary: true,
              cell: (o) => (
                <>
                  {o.role ? ROLE_LABELS[o.role] : 'Object'}
                  {o.rendition && (
                    <span className="ml-1.5 font-normal text-muted-foreground">{o.rendition}</span>
                  )}
                </>
              ),
            },
            {
              id: 'id',
              header: 'Object ID',
              cell: (o) => (
                <ObjectIdBadge
                  value={o.object_id}
                  truncate={6}
                  copyLabel={`Copy object ID ${o.object_id.slice(0, 8)}`}
                />
              ),
            },
            { id: 'size', header: 'Size', align: 'right', cell: (o) => formatBytes(o.size) },
            {
              id: 'slabs',
              header: 'Slabs',
              align: 'right',
              cell: (o) => (
                <>
                  {formatCount(o.slab_count)}
                  {o.shared_slab_count > 0 && (
                    <Badge
                      variant="secondary"
                      className="ml-1.5"
                      title="Slabs shared with other objects of this video"
                    >
                      {formatCount(o.shared_slab_count)} shared
                    </Badge>
                  )}
                </>
              ),
            },
            {
              id: 'sectors',
              header: 'Sectors',
              align: 'right',
              cell: (o) => formatCount(o.sector_count),
            },
            {
              id: 'hosts',
              header: 'Hosts',
              align: 'right',
              cell: (o) => formatCount(o.host_count),
            },
          ]}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Host distribution</CardTitle>
            <CardDescription>
              Sectors per host, each shared slab counted once. Links open {explorer.label}.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            <HostRows hosts={info.hosts.slice(0, HOSTS_SHOWN)} explorer={explorer} />
            <Collapse open={showAllHosts} id="more-hosts" className="flex flex-col gap-1">
              <HostRows hosts={info.hosts.slice(HOSTS_SHOWN)} explorer={explorer} />
            </Collapse>
            {info.hosts.length > HOSTS_SHOWN && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 self-start"
                aria-expanded={showAllHosts}
                aria-controls="more-hosts"
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
              <>
                <CountryRows
                  countries={info.countries.slice(0, COUNTRIES_SHOWN)}
                  max={maxCountrySectors}
                />
                <Collapse
                  open={showAllCountries}
                  id="more-countries"
                  className="flex flex-col gap-3"
                >
                  <CountryRows
                    countries={info.countries.slice(COUNTRIES_SHOWN)}
                    max={maxCountrySectors}
                  />
                </Collapse>
                {info.countries.length > COUNTRIES_SHOWN && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="self-start"
                    aria-expanded={showAllCountries}
                    aria-controls="more-countries"
                    onClick={() => setShowAllCountries((v) => !v)}
                  >
                    {showAllCountries
                      ? 'Show fewer'
                      : `Show all ${info.countries.length} countries`}
                  </Button>
                )}
              </>
            )}
            {info.hosts.some((h) => !h.country_code) && (
              <p className="text-xs text-muted-foreground">
                &ldquo;Unknown&rdquo; means the Sia indexer did not report the host&apos;s location.
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

type Explorer = ReturnType<typeof explorerFor>;

function HostRows({ hosts, explorer }: { hosts: SiaStorageInfo['hosts']; explorer: Explorer }) {
  return hosts.map((h) => (
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
        <span>{h.country_code ? countryName(h.country_code) : 'Unknown'}</span>
        <span className="w-20 text-right tabular-nums">{plural(h.sectors, 'sector')}</span>
      </span>
    </div>
  ));
}

function CountryRows({ countries, max }: { countries: SiaStorageInfo['countries']; max: number }) {
  return countries.map((c) => (
    <div key={c.country_code} className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-sm">
        <span>{countryName(c.country_code)}</span>
        <span className="text-muted-foreground tabular-nums">
          {plural(c.sectors, 'sector')}, {plural(c.hosts, 'host')}
        </span>
      </div>
      <Progress
        value={(c.sectors / max) * 100}
        aria-label={`${countryName(c.country_code)} share`}
      />
    </div>
  ));
}
