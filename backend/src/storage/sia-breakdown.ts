/**
 * Per-asset Sia storage breakdown, computed from what the indexer reports for
 * each object. Pure, so the accounting is testable without a network.
 *
 * Objects uploaded together share slabs (the pipeline packs the rendition
 * data with the thumbnails, then the playlists): each references its byte range inside the same
 * erasure-coded slab. Summing slabs per object would count a shared slab once
 * per object, so totals dedupe slabs by identity and count each one once.
 */

/** Sia's sector size: every host stores one 4 MiB sector per slab it holds. */
export const SECTOR_SIZE_BYTES = 4 * 1024 * 1024;

export interface SectorSnapshot {
  root: string;
  hostKey: string;
}

export interface SlabSnapshot {
  minShards: number;
  /** Byte range of this object inside the slab. */
  offset: number;
  length: number;
  sectors: SectorSnapshot[];
}

/** What the indexer reports for one object. */
export interface ObjectSnapshot {
  id: string;
  size: number;
  /** Bytes after erasure coding, as the indexer computes it for this object. */
  encodedSize: number;
  slabs: SlabSnapshot[];
  createdAt: string;
}

export type ObjectRole = 'master_manifest' | 'variant_playlist' | 'rendition_data' | 'thumbnail';

export interface AssetObjectRef {
  objectId: string;
  role: ObjectRole | null;
  /** Rendition name (e.g. "720p") for playlist and media objects. */
  rendition: string | null;
}

export interface HostInfo {
  publicKey: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  goodForUpload: boolean;
}

export interface ObjectBreakdown {
  objectId: string;
  role: ObjectRole | null;
  rendition: string | null;
  size: number;
  /** Encoded size of the slabs this object references, shared slabs in full. */
  encodedSize: number;
  slabCount: number;
  sectorCount: number;
  /** Slabs this object shares with another object of the same asset. */
  sharedSlabCount: number;
  hostCount: number;
  createdAt: string;
}

export interface HostBreakdown {
  publicKey: string;
  /** Sectors of this asset the host stores (each shared slab counted once). */
  sectors: number;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
  goodForUpload: boolean | null;
}

export interface CountryBreakdown {
  countryCode: string;
  hosts: number;
  sectors: number;
}

export interface SiaBreakdown {
  objects: ObjectBreakdown[];
  /** Objects the indexer could not describe (listed, not silently dropped). */
  unavailable: string[];
  totals: {
    objectCount: number;
    /** Bytes stored, before erasure coding. */
    rawBytes: number;
    /**
     * Bytes the asset occupies on hosts after erasure coding: every unique
     * slab's sectors, each a full 4 MiB. Per-object encoded sizes are not
     * summed, because the indexer reports a slab's full size for every object
     * that references it, so shared slabs would be counted once per object.
     */
    encodedBytes: number;
    uniqueSlabCount: number;
    uniqueSectorCount: number;
    dataShards: number | null;
    parityShards: number | null;
    /** totalShards / dataShards for the asset's slabs; null if they differ or none. */
    redundancyRatio: number | null;
    hostCount: number;
    countryCount: number;
  };
  hosts: HostBreakdown[];
  countries: CountryBreakdown[];
}

/** A slab's identity: its sector roots, which are content hashes. */
function slabKey(slab: SlabSnapshot): string {
  return slab.sectors.map((s) => s.root).join(',');
}

export function buildSiaBreakdown(
  refs: AssetObjectRef[],
  snapshots: Map<string, ObjectSnapshot | null>,
  hosts: HostInfo[],
): SiaBreakdown {
  const hostInfo = new Map(hosts.map((h) => [h.publicKey, h]));

  // first pass: which object references each slab
  const slabOwners = new Map<string, Set<string>>();
  const uniqueSlabs = new Map<string, SlabSnapshot>();
  for (const ref of refs) {
    const snap = snapshots.get(ref.objectId);
    if (!snap) continue;
    for (const slab of snap.slabs) {
      if (slab.sectors.length === 0) continue;
      const key = slabKey(slab);
      uniqueSlabs.set(key, slab);
      const owners = slabOwners.get(key) ?? new Set<string>();
      owners.add(ref.objectId);
      slabOwners.set(key, owners);
    }
  }

  const objects: ObjectBreakdown[] = [];
  const unavailable: string[] = [];
  let rawBytes = 0;

  for (const ref of refs) {
    const snap = snapshots.get(ref.objectId);
    if (!snap) {
      unavailable.push(ref.objectId);
      continue;
    }
    const slabs = snap.slabs.filter((s) => s.sectors.length > 0);
    const objectHosts = new Set(slabs.flatMap((s) => s.sectors.map((sec) => sec.hostKey)));
    rawBytes += snap.size;
    objects.push({
      objectId: ref.objectId,
      role: ref.role,
      rendition: ref.rendition,
      size: snap.size,
      encodedSize: snap.encodedSize,
      slabCount: slabs.length,
      sectorCount: slabs.reduce((n, s) => n + s.sectors.length, 0),
      sharedSlabCount: slabs.filter((s) => (slabOwners.get(slabKey(s))?.size ?? 0) > 1).length,
      hostCount: objectHosts.size,
      createdAt: snap.createdAt,
    });
  }

  // host distribution over unique slabs, so a shared slab's sectors count once
  const sectorsByHost = new Map<string, number>();
  let uniqueSectorCount = 0;
  const shardConfigs = new Set<string>();
  for (const slab of uniqueSlabs.values()) {
    uniqueSectorCount += slab.sectors.length;
    shardConfigs.add(`${slab.minShards}/${slab.sectors.length}`);
    for (const sec of slab.sectors) {
      sectorsByHost.set(sec.hostKey, (sectorsByHost.get(sec.hostKey) ?? 0) + 1);
    }
  }

  const hostRows: HostBreakdown[] = [...sectorsByHost.entries()]
    .map(([publicKey, sectors]) => {
      const info = hostInfo.get(publicKey);
      return {
        publicKey,
        sectors,
        countryCode: info?.countryCode || null,
        latitude: info ? info.latitude : null,
        longitude: info ? info.longitude : null,
        goodForUpload: info ? info.goodForUpload : null,
      };
    })
    .sort((a, b) => b.sectors - a.sectors || a.publicKey.localeCompare(b.publicKey));

  const byCountry = new Map<string, CountryBreakdown>();
  for (const h of hostRows) {
    if (!h.countryCode) continue;
    const c = byCountry.get(h.countryCode) ?? { countryCode: h.countryCode, hosts: 0, sectors: 0 };
    c.hosts += 1;
    c.sectors += h.sectors;
    byCountry.set(h.countryCode, c);
  }
  const countries = [...byCountry.values()].sort(
    (a, b) => b.sectors - a.sectors || a.countryCode.localeCompare(b.countryCode),
  );

  // one erasure-coding scheme is the normal case; if slabs disagree, say so
  // with nulls rather than reporting one slab's numbers as the asset's
  let dataShards: number | null = null;
  let parityShards: number | null = null;
  let redundancyRatio: number | null = null;
  if (shardConfigs.size === 1) {
    const [min, total] = [...shardConfigs][0].split('/').map(Number);
    if (min > 0) {
      dataShards = min;
      parityShards = total - min;
      redundancyRatio = total / min;
    }
  }

  return {
    objects,
    unavailable,
    totals: {
      objectCount: refs.length,
      rawBytes,
      encodedBytes: uniqueSectorCount * SECTOR_SIZE_BYTES,
      uniqueSlabCount: uniqueSlabs.size,
      uniqueSectorCount,
      dataShards,
      parityShards,
      redundancyRatio,
      hostCount: hostRows.length,
      countryCount: countries.length,
    },
    hosts: hostRows,
    countries,
  };
}
