/**
 * Pure normalization of a video's Sia upload results into the
 * `renditions` + `artifacts` shape persisted in Postgres.
 *
 * This is the mapping M1 verification requires: every Sia Object ID is
 * tied to its parent asset and (where applicable) its rendition and role.
 * The uploader already knows all of this per variant; this module just
 * reshapes it into normalized rows. Kept pure (no I/O) so it is trivially
 * testable and has no Sia/DB coupling.
 */

export type ArtifactRole =
  | 'master_manifest'
  | 'variant_playlist'
  | 'rendition_data'
  | 'thumbnail';

/** One rendition's upload outcome, as known by the segment uploader. */
export interface VariantUpload {
  name: string;
  width: number | null;
  height: number | null;
  videoBitrateKbps: number | null;
  segmentCount: number;
  dataObjectId: string;
  dataByteSize: number;
  playlistObjectId: string;
  playlistByteSize: number;
}

export interface ThumbnailUpload {
  objectId: string;
  byteSize: number;
}

export interface MasterUpload {
  objectId: string;
  byteSize: number;
}

/** A normalized rendition row (quality level metadata + its object ids). */
export interface RenditionRecord {
  name: string;
  width: number | null;
  height: number | null;
  videoBitrateKbps: number | null;
  segmentCount: number;
  byteSize: number;
  dataObjectId: string;
  playlistObjectId: string;
}

/** A normalized artifact row: one stored Sia object, its role and rendition. */
export interface ArtifactRecord {
  role: ArtifactRole;
  objectId: string;
  byteSize: number;
  /** The rendition this artifact belongs to, or null for asset-level objects. */
  renditionName: string | null;
}

export interface StorageRecords {
  renditions: RenditionRecord[];
  artifacts: ArtifactRecord[];
}

/** A ready-to-insert `artifacts` row (rendition FK resolved). */
export interface ArtifactRow {
  videoAssetId: string;
  renditionId: string | null;
  role: ArtifactRole;
  objectId: string;
  byteSize: number;
}

/**
 * Resolve each artifact's `renditionName` to the DB id of the rendition
 * that was just inserted, producing rows ready for a bulk `artifacts`
 * insert. Asset-level artifacts (master manifest, thumbnails) get a null
 * renditionId. Throws if an artifact references a rendition name that was
 * not inserted — that would be a mapping bug, and silently dropping the
 * link would corrupt the storage graph.
 */
export function resolveArtifactRows(
  videoAssetId: string,
  insertedRenditions: Array<{ id: string; name: string }>,
  artifacts: ArtifactRecord[],
): ArtifactRow[] {
  const idByName = new Map(insertedRenditions.map((r) => [r.name, r.id]));

  return artifacts.map((a) => {
    let renditionId: string | null = null;
    if (a.renditionName !== null) {
      const resolved = idByName.get(a.renditionName);
      if (!resolved) {
        throw new Error(
          `resolveArtifactRows: no inserted rendition named "${a.renditionName}" for artifact ${a.objectId}`,
        );
      }
      renditionId = resolved;
    }
    return {
      videoAssetId,
      renditionId,
      role: a.role,
      objectId: a.objectId,
      byteSize: a.byteSize,
    };
  });
}

export function buildStorageRecords(input: {
  variants: VariantUpload[];
  thumbnails: ThumbnailUpload[];
  master: MasterUpload;
}): StorageRecords {
  const { variants, thumbnails, master } = input;

  const renditions: RenditionRecord[] = variants.map((v) => ({
    name: v.name,
    width: v.width,
    height: v.height,
    videoBitrateKbps: v.videoBitrateKbps,
    segmentCount: v.segmentCount,
    byteSize: v.dataByteSize,
    dataObjectId: v.dataObjectId,
    playlistObjectId: v.playlistObjectId,
  }));

  const artifacts: ArtifactRecord[] = [
    { role: 'master_manifest', objectId: master.objectId, byteSize: master.byteSize, renditionName: null },
  ];

  for (const v of variants) {
    artifacts.push({
      role: 'rendition_data',
      objectId: v.dataObjectId,
      byteSize: v.dataByteSize,
      renditionName: v.name,
    });
    artifacts.push({
      role: 'variant_playlist',
      objectId: v.playlistObjectId,
      byteSize: v.playlistByteSize,
      renditionName: v.name,
    });
  }

  for (const t of thumbnails) {
    artifacts.push({
      role: 'thumbnail',
      objectId: t.objectId,
      byteSize: t.byteSize,
      renditionName: null,
    });
  }

  return { renditions, artifacts };
}
