import { Router, type Request, type Response } from 'express';
import { requireScope } from '../middleware/api-key.js';
import { ownerFilter } from '../ownership.js';
import { AppError } from '../middleware/error-handler.js';
import { logger } from '../../config/logger.js';
import {
  buildSiaBreakdown,
  type AssetObjectRef,
  type HostInfo,
  type ObjectSnapshot,
  type SiaBreakdown,
} from '../../storage/sia-breakdown.js';

export interface SiaInfoAssetRecord {
  id: string;
  manifestObjectId: string | null;
  thumbnailObjectIds: string[];
  siaObjectIds: string[];
  status: string;
}

export interface SiaInfoArtifact {
  objectId: string;
  /** null for an object stored before roles were recorded. */
  role: 'master_manifest' | 'variant_playlist' | 'rendition_data' | 'thumbnail' | null;
  renditionName: string | null;
}

export interface SiaInfoRouteDeps {
  /** `owner` scopes the lookup to the caller's owner, the workspace (undefined = every owner). */
  getAssetWithSiaIds: (id: string, owner?: string) => Promise<SiaInfoAssetRecord | null>;
  /** Every stored object of the asset with its role, from the artifacts table. */
  getAssetArtifacts: (assetId: string) => Promise<SiaInfoArtifact[]>;
  /** What the indexer reports for one object. */
  inspectSiaObject: (objectId: string) => Promise<ObjectSnapshot>;
  /** The indexer's usable hosts, for country and location. */
  listSiaHosts: () => Promise<HostInfo[]>;
  /** Active contracts per host; null when no indexd admin API is configured. */
  getHostContracts: () => Promise<Map<string, string[]> | null>;
  /** Wallet behind the indexer; null when unknown. */
  getWalletAddress: () => Promise<string | null>;
  siaIndexer: { url: string; network: string };
}

// A breakdown touches every object of the asset on the indexer, so it is
// cached briefly per asset; the host list is the same for every asset and
// changes slowly, so it is cached longer.

const BREAKDOWN_TTL_MS = 30_000;
const HOSTS_TTL_MS = 5 * 60_000;

const breakdownCache = new Map<string, { data: unknown; expiresAt: number }>();
let hostsCache: { hosts: HostInfo[]; expiresAt: number } | null = null;

function getCached(id: string): unknown | null {
  const entry = breakdownCache.get(id);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    breakdownCache.delete(id);
    return null;
  }
  return entry.data;
}

function setCached(id: string, data: unknown): void {
  const now = Date.now();
  // expired entries are otherwise only dropped when re-read, so sweep them
  // here to keep the map bounded by what was viewed in the last ttl window
  for (const [key, entry] of breakdownCache) {
    if (entry.expiresAt < now) breakdownCache.delete(key);
  }
  breakdownCache.set(id, { data, expiresAt: now + BREAKDOWN_TTL_MS });
}

/** Test hook: drop every cached breakdown and the host list. */
export function clearSiaInfoCache(): void {
  breakdownCache.clear();
  hostsCache = null;
}

async function cachedHosts(deps: SiaInfoRouteDeps): Promise<HostInfo[]> {
  if (hostsCache && hostsCache.expiresAt > Date.now()) return hostsCache.hosts;
  try {
    const hosts = await deps.listSiaHosts();
    hostsCache = { hosts, expiresAt: Date.now() + HOSTS_TTL_MS };
    return hosts;
  } catch (err) {
    // countries are an enrichment; the breakdown still stands without them
    logger.warn({ err }, 'Failed to list Sia hosts for the storage breakdown');
    return hostsCache?.hosts ?? [];
  }
}

// objects without a recorded role go last
const ROLE_ORDER = ['master_manifest', 'variant_playlist', 'rendition_data', 'thumbnail', null];

/**
 * The asset's objects with their roles. The artifacts table is the source of
 * truth; assets stored before it existed fall back to the ids on the asset row.
 */
export function objectRefs(
  asset: SiaInfoAssetRecord,
  artifacts: SiaInfoArtifact[],
): AssetObjectRef[] {
  if (artifacts.length > 0) {
    return [...artifacts]
      .sort(
        (a, b) =>
          ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
          (a.renditionName ?? '').localeCompare(b.renditionName ?? '', undefined, {
            numeric: true,
          }),
      )
      .map((a) => ({ objectId: a.objectId, role: a.role, rendition: a.renditionName }));
  }
  const seen = new Set<string>();
  const refs: AssetObjectRef[] = [];
  const add = (objectId: string | null, role: AssetObjectRef['role']) => {
    if (!objectId || seen.has(objectId)) return;
    seen.add(objectId);
    refs.push({ objectId, role, rendition: null });
  };
  add(asset.manifestObjectId, 'master_manifest');
  for (const id of asset.thumbnailObjectIds) add(id, 'thumbnail');
  for (const id of asset.siaObjectIds) add(id, null);
  return refs;
}

function formatBreakdown(
  asset: SiaInfoAssetRecord,
  b: SiaBreakdown,
  contracts: Map<string, string[]> | null,
  walletAddress: string | null,
  indexer: { url: string; network: string },
) {
  const assetHosts = new Set(b.hosts.map((h) => h.publicKey));
  const contractIds = contracts
    ? [
        ...new Set(
          [...contracts].filter(([host]) => assetHosts.has(host)).flatMap(([, ids]) => ids),
        ),
      ]
    : null;

  return {
    manifest_object_id: asset.manifestObjectId,
    objects: b.objects.map((o) => ({
      object_id: o.objectId,
      role: o.role,
      rendition: o.rendition,
      size: o.size,
      encoded_size: o.encodedSize,
      slab_count: o.slabCount,
      sector_count: o.sectorCount,
      shared_slab_count: o.sharedSlabCount,
      host_count: o.hostCount,
      created_at: o.createdAt,
    })),
    unavailable_object_ids: b.unavailable,
    totals: {
      object_count: b.totals.objectCount,
      raw_bytes: b.totals.rawBytes,
      encoded_bytes: b.totals.encodedBytes,
      unique_slab_count: b.totals.uniqueSlabCount,
      unique_sector_count: b.totals.uniqueSectorCount,
      // the same number as encoded_bytes, kept so existing clients still read it
      sector_bytes: b.totals.encodedBytes,
      data_shards: b.totals.dataShards,
      parity_shards: b.totals.parityShards,
      redundancy_ratio: b.totals.redundancyRatio,
      host_count: b.totals.hostCount,
      country_count: b.totals.countryCount,
    },
    hosts: b.hosts.map((h) => ({
      public_key: h.publicKey,
      sectors: h.sectors,
      country_code: h.countryCode,
      latitude: h.latitude,
      longitude: h.longitude,
      good_for_upload: h.goodForUpload,
    })),
    countries: b.countries.map((c) => ({
      country_code: c.countryCode,
      hosts: c.hosts,
      sectors: c.sectors,
    })),
    contracts: contractIds,
    indexer: {
      url: indexer.url,
      network: indexer.network,
      wallet_address: walletAddress,
    },
  };
}

export function createSiaInfoRoutes(deps: SiaInfoRouteDeps): Router {
  const router = Router();

  /**
   * GET /api/v1/assets/:id/sia
   * Per-asset Sia storage breakdown from the indexer: every object with its
   * role, size, encoded size, slabs and sectors; deduplicated totals; shard
   * config and redundancy; and which hosts (and countries) hold the sectors.
   */
  router.get('/:id/sia', requireScope('read'), async (req: Request, res: Response) => {
    const id = String(req.params.id);

    // ownership first: the cache is keyed by asset id alone, so serving it
    // before this check would hand another tenant's breakdown to anyone who
    // knows the id while the entry is warm
    const asset = await deps.getAssetWithSiaIds(id, ownerFilter(req.apiKey!.creatorAddress));
    if (!asset) {
      throw new AppError(404, 'Video asset not found');
    }

    const cached = getCached(id);
    if (cached) {
      res.json(cached);
      return;
    }

    const refs = objectRefs(asset, await deps.getAssetArtifacts(id));
    const [snapshots, hosts, contracts, walletAddress] = await Promise.all([
      Promise.all(
        refs.map(async (ref) => {
          try {
            return [ref.objectId, await deps.inspectSiaObject(ref.objectId)] as const;
          } catch (err) {
            logger.warn({ objectId: ref.objectId, err }, 'Failed to inspect Sia object');
            return [ref.objectId, null] as const;
          }
        }),
      ),
      cachedHosts(deps),
      deps.getHostContracts().catch(() => null),
      deps.getWalletAddress().catch(() => null),
    ]);

    const breakdown = buildSiaBreakdown(refs, new Map(snapshots), hosts);
    const body = formatBreakdown(asset, breakdown, contracts, walletAddress, deps.siaIndexer);
    // a partial answer (indexer hiccup) is shown but not cached, so the next
    // view tries again instead of pinning the gap for the ttl
    if (breakdown.unavailable.length === 0) setCached(id, body);
    res.json(body);
  });

  return router;
}
