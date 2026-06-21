import { Router, type Request, type Response } from 'express';
import { requireScope } from '../middleware/api-key.js';
import { AppError } from '../middleware/error-handler.js';
import { getObject, downloadObject } from '../../storage/sia-client.js';
import { parseMasterPlaylist, parseVariantPlaylist } from '../../transcode/manifest-rewriter.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface SiaInfoAssetRecord {
  id: string;
  manifestObjectId: string | null;
  thumbnailObjectIds: string[];
  siaObjectIds: string[];
  totalStorageBytes: number;
  status: string;
}

export interface SiaInfoRouteDeps {
  /**
   * Fetch the DB record for a video asset including the full list of
   * Sia object IDs. Returns `null` when the asset does not exist.
   */
  getAssetWithSiaIds: (id: string) => Promise<SiaInfoAssetRecord | null>;
}

// ---------------------------------------------------------------------------
// Response shape
// ---------------------------------------------------------------------------

interface ObjectSummary {
  size: number;
  slabCount: number;
  sectorCount: number;
  /** Erasure-coding shard count per slab — derived from slab metadata. */
  minShards: number;
  totalShards: number;
  createdAt: string | null;
  updatedAt: string | null;
  hosts: string[];
}

interface VariantInfo {
  resolution: string;
  bitrateKbps: number;
  dataObjectId: string;
  playlistObjectId: string;
  dataSize: number;
  segmentCount: number;
  hostCount: number;
  hosts: string[];
  slabCount: number;
  /** Total sectors across the variant's data+playlist slabs (real count). */
  sectorCount: number;
  /**
   * On-disk bytes for this variant across all hosts, computed from the
   * variant's real sector count (sectorCount × 4 MiB). Null when no
   * slabs have been observed yet.
   */
  encodedBytes: number | null;
  /** Data shards per slab, read from slab metadata. Null if unknown. */
  minShards: number | null;
  /** Total shards per slab (data + parity), read from slab metadata. */
  totalShards: number | null;
}

interface ThumbnailInfo {
  objectId: string;
  size: number;
}

interface SiaInfoResponse {
  manifestObjectId: string | null;
  manifest: ObjectSummary | null;
  variants: VariantInfo[];
  thumbnails: ThumbnailInfo[];
  totals: {
    objectCount: number;
    rawBytes: number;
    /**
     * On-disk bytes across all hosts including erasure-coding overhead,
     * computed from real slab sector counts (sectorCount × SECTOR_SIZE).
     * Null when no slabs were observed.
     */
    encodedBytes: number | null;
    /**
     * Redundancy ratio (total shards / data shards) observed in this
     * video's slabs. Null when no slabs were observed. Assumes a uniform
     * coding across slabs (which the SDK guarantees for a single upload).
     */
    redundancyRatio: number | null;
    /** Data shards per slab, read from slab metadata. Null if unknown. */
    dataShards: number | null;
    /** Parity shards per slab, read from slab metadata. Null if unknown. */
    parityShards: number | null;
    uniqueHostCount: number;
    allHosts: string[];
  };
  indexer: {
    url: string;
    network: 'zen' | 'mainnet';
  };
}

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------
//
// Sia lookups are individually quick (a few ms each) but a full asset
// breakdown touches N objects and parses the manifest — on the order of a
// few hundred ms end-to-end. Cache by asset id for a short window so the
// frontend can poll the endpoint without thrashing the indexer.

interface CacheEntry {
  data: SiaInfoResponse;
  expiresAt: number;
}

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, CacheEntry>();

function getCached(id: string): SiaInfoResponse | null {
  const entry = cache.get(id);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(id);
    return null;
  }
  return entry.data;
}

function setCached(id: string, data: SiaInfoResponse): void {
  cache.set(id, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Sia's on-disk shard size (4 MiB). Each host stores one 4 MiB sector per
 * slab it participates in. This is a Sia protocol constant, not a tunable.
 */
const SECTOR_SIZE_BYTES = 4 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectNetwork(network: string): 'zen' | 'mainnet' {
  const n = network.toLowerCase();
  if (n === 'zen' || n === 'testnet') return 'zen';
  return 'mainnet';
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

/**
 * SDK slab sectors (from PinnedObject.slabs()) are typed as `unknown`. We
 * extract fields defensively by walking the shape that sia-storage returns.
 */
interface RawSlab {
  minShards?: number;
  sectors?: Array<{ hostKey?: string }>;
}

function extractHostsFromSlabs(slabs: unknown[]): string[] {
  const hosts: string[] = [];
  for (const slab of slabs) {
    const sectors = (slab as RawSlab).sectors ?? [];
    for (const sec of sectors) {
      if (sec?.hostKey) hosts.push(sec.hostKey);
    }
  }
  return hosts;
}

function countSectors(slabs: unknown[]): number {
  let count = 0;
  for (const slab of slabs) {
    const sectors = (slab as RawSlab).sectors ?? [];
    count += sectors.length;
  }
  return count;
}

/**
 * Read per-slab shard counts from the slab metadata. All slabs in a
 * single upload share the same erasure-coding configuration (the Sia
 * SDK applies one scheme per upload call), so we inspect the first slab
 * that has any sectors and report that. Returns {minShards: 0,
 * totalShards: 0} when no slabs with sectors are present (object has no
 * stored data yet — e.g., failed upload).
 */
function readShardCounts(slabs: unknown[]): {
  minShards: number;
  totalShards: number;
} {
  for (const slab of slabs) {
    const raw = slab as RawSlab;
    const totalShards = raw.sectors?.length ?? 0;
    if (totalShards > 0) {
      return {
        minShards: raw.minShards ?? 0,
        totalShards,
      };
    }
  }
  return { minShards: 0, totalShards: 0 };
}

async function summarizeObject(objectId: string): Promise<ObjectSummary | null> {
  try {
    const obj = await getObject(objectId);
    const slabs = obj.slabs();
    const shards = readShardCounts(slabs);
    return {
      size: Number(obj.size()),
      slabCount: slabs.length,
      sectorCount: countSectors(slabs),
      minShards: shards.minShards,
      totalShards: shards.totalShards,
      createdAt: obj.createdAt()?.toISOString() ?? null,
      updatedAt: obj.updatedAt()?.toISOString() ?? null,
      hosts: dedupe(extractHostsFromSlabs(slabs)),
    };
  } catch (err) {
    logger.warn({ objectId, err }, 'Failed to summarize Sia object');
    return null;
  }
}

/**
 * Parse EXT-X-STREAM-INF lines and pair each with the following playlist
 * URI. We accept both plain filenames and our rewritten gateway URLs of
 * the form `/v1/objects/<objectId>` — the object ID is the last path
 * segment.
 */
interface ParsedStreamInfo {
  bandwidth: number;
  resolution: string;
  playlistObjectId: string;
}

function parseMasterStreamInfs(masterContent: string): ParsedStreamInfo[] {
  const lines = masterContent.split('\n');
  const results: ParsedStreamInfo[] = [];
  let pendingStreamInf: { bandwidth: number; resolution: string } | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('#EXT-X-STREAM-INF')) {
      const bwMatch = line.match(/BANDWIDTH=(\d+)/);
      const resMatch = line.match(/RESOLUTION=([^,\s]+)/);
      pendingStreamInf = {
        bandwidth: bwMatch ? parseInt(bwMatch[1], 10) : 0,
        resolution: resMatch ? resMatch[1] : '',
      };
      continue;
    }
    if (!line || line.startsWith('#')) continue;
    if (pendingStreamInf) {
      // Extract the object ID from the line — can be `playlist.m3u8` (rare,
      // for un-rewritten output) or `/v1/objects/<id>` (after rewrite).
      const m = line.match(/\/v1\/objects\/([A-Fa-f0-9]+)/);
      const playlistObjectId = m ? m[1] : line;
      results.push({
        ...pendingStreamInf,
        playlistObjectId,
      });
      pendingStreamInf = null;
    }
  }

  return results;
}

/**
 * Given a (rewritten) variant playlist body, return the Sia object ID of
 * its single data file. The EXT-X-MAP URI points at the gateway URL
 * `/v1/objects/<id>` after rewriteVariantPlaylist() has run.
 */
function extractDataObjectId(playlistContent: string): string | null {
  const lines = playlistContent.split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.startsWith('#EXT-X-MAP')) {
      const uriMatch = line.match(/URI="([^"]+)"/);
      if (uriMatch) {
        const idMatch = uriMatch[1].match(/\/v1\/objects\/([A-Fa-f0-9]+)/);
        return idMatch ? idMatch[1] : uriMatch[1];
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

async function buildSiaInfo(
  asset: SiaInfoAssetRecord,
): Promise<SiaInfoResponse> {
  // The "indexer URL" is an opaque identifier for the Sia network this
  // deployment is talking to. With the renterd backend we don't have a
  // single public indexer URL, so we label by network only.
  const indexerUrl = env.RENTERD_API_URL;
  const network = detectNetwork(env.SIA_NETWORK);

  const allHosts = new Set<string>();
  let rawBytes = 0;
  let totalSectorCount = 0;
  let observedMinShards = 0;
  let observedTotalShards = 0;

  // Helper that folds an object's summary into the running totals.
  const accumulate = (summary: ObjectSummary | null): void => {
    if (!summary) return;
    for (const h of summary.hosts) allHosts.add(h);
    rawBytes += summary.size;
    totalSectorCount += summary.sectorCount;
    // Record the first non-zero shard config we see; all slabs in a
    // single upload share this config.
    if (observedTotalShards === 0 && summary.totalShards > 0) {
      observedMinShards = summary.minShards;
      observedTotalShards = summary.totalShards;
    }
  };

  // ── Manifest ───────────────────────────────────────────────────────
  let manifestSummary: ObjectSummary | null = null;
  const variants: VariantInfo[] = [];

  if (asset.manifestObjectId) {
    manifestSummary = await summarizeObject(asset.manifestObjectId);
    accumulate(manifestSummary);

    // Download + parse the master manifest to map variants → playlist IDs.
    try {
      const masterBytes = await downloadObject(asset.manifestObjectId);
      const masterContent = new TextDecoder().decode(masterBytes);
      const streamInfs = parseMasterStreamInfs(masterContent);

      // Parallel-summarize each variant.
      const perVariant = await Promise.all(
        streamInfs.map(async (info) => {
          const [playlistSummary, playlistBytes] = await Promise.all([
            summarizeObject(info.playlistObjectId),
            downloadObject(info.playlistObjectId).catch(() => null),
          ]);

          let dataObjectId = '';
          let segmentCount = 0;
          if (playlistBytes) {
            const playlistText = new TextDecoder().decode(playlistBytes);
            dataObjectId = extractDataObjectId(playlistText) ?? '';
            segmentCount = parseVariantPlaylist(playlistText).segmentCount;
          }

          const dataSummary = dataObjectId
            ? await summarizeObject(dataObjectId)
            : null;

          accumulate(playlistSummary);
          accumulate(dataSummary);

          const variantHosts = dedupe([
            ...(playlistSummary?.hosts ?? []),
            ...(dataSummary?.hosts ?? []),
          ]);
          const dataSize = dataSummary?.size ?? 0;

          // Prefer the data object's shard config (it is the big one and
          // always has slabs if the object exists). Fall back to the
          // playlist object if data isn't available.
          const summaryForShards =
            (dataSummary?.totalShards ?? 0) > 0
              ? dataSummary
              : (playlistSummary?.totalShards ?? 0) > 0
                ? playlistSummary
                : null;

          const variantSectorCount =
            (playlistSummary?.sectorCount ?? 0) +
            (dataSummary?.sectorCount ?? 0);

          return {
            resolution: info.resolution,
            bitrateKbps: Math.round(info.bandwidth / 1000),
            dataObjectId,
            playlistObjectId: info.playlistObjectId,
            dataSize,
            segmentCount,
            hostCount: variantHosts.length,
            hosts: variantHosts,
            slabCount:
              (playlistSummary?.slabCount ?? 0) + (dataSummary?.slabCount ?? 0),
            sectorCount: variantSectorCount,
            encodedBytes:
              variantSectorCount > 0
                ? variantSectorCount * SECTOR_SIZE_BYTES
                : null,
            minShards: summaryForShards?.minShards ?? null,
            totalShards: summaryForShards?.totalShards ?? null,
          } satisfies VariantInfo;
        }),
      );
      variants.push(...perVariant);
    } catch (err) {
      logger.warn(
        { manifestObjectId: asset.manifestObjectId, err },
        'Failed to derive per-variant Sia breakdown from master manifest',
      );
    }
  }

  // ── Thumbnails ─────────────────────────────────────────────────────
  const thumbnails: ThumbnailInfo[] = [];
  const thumbSummaries = await Promise.all(
    asset.thumbnailObjectIds.map(async (tid) => ({
      objectId: tid,
      summary: await summarizeObject(tid),
    })),
  );
  for (const { objectId, summary } of thumbSummaries) {
    if (!summary) continue;
    accumulate(summary);
    thumbnails.push({ objectId, size: summary.size });
  }

  // ── Totals — all derived from observed slab metadata ────────────────
  const totalRawBytes = asset.totalStorageBytes > 0 ? asset.totalStorageBytes : rawBytes;

  // Real encoded size = total sectors × 4 MiB. A sector is the physical
  // unit a host stores; total sector count reflects both data + parity
  // shards across every slab.
  const encodedBytes =
    totalSectorCount > 0 ? totalSectorCount * SECTOR_SIZE_BYTES : null;

  // Real data/parity split read from the first slab we observed.
  const dataShards = observedMinShards > 0 ? observedMinShards : null;
  const parityShards =
    observedTotalShards > 0 && observedMinShards > 0
      ? observedTotalShards - observedMinShards
      : null;
  const redundancyRatio =
    observedTotalShards > 0 && observedMinShards > 0
      ? observedTotalShards / observedMinShards
      : null;

  const objectCount =
    asset.siaObjectIds.length > 0
      ? asset.siaObjectIds.length
      : (asset.manifestObjectId ? 1 : 0) +
        asset.thumbnailObjectIds.length +
        variants.length * 2;

  return {
    manifestObjectId: asset.manifestObjectId,
    manifest: manifestSummary,
    variants,
    thumbnails,
    totals: {
      objectCount,
      rawBytes: totalRawBytes,
      encodedBytes,
      redundancyRatio,
      dataShards,
      parityShards,
      uniqueHostCount: allHosts.size,
      allHosts: Array.from(allHosts),
    },
    indexer: {
      url: indexerUrl,
      network,
    },
  };
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export function createSiaInfoRoutes(deps: SiaInfoRouteDeps): Router {
  const router = Router();

  /**
   * GET /api/v1/assets/:id/sia
   * Rich Sia-side breakdown for a given asset. Includes per-variant object
   * IDs, host maps, slab/sector counts, redundancy, and an estimated
   * monthly storage cost.
   */
  router.get('/:id/sia', requireScope('read'), async (req: Request, res: Response) => {
    const id = String(req.params.id);

    const cached = getCached(id);
    if (cached) {
      res.json(cached);
      return;
    }

    const asset = await deps.getAssetWithSiaIds(id);
    if (!asset) {
      throw new AppError(404, 'Video asset not found');
    }

    const info = await buildSiaInfo(asset);
    setCached(id, info);
    res.json(info);
  });

  return router;
}
