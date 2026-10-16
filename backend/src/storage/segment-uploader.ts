import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { uploadAndPin, uploadAndPinPacked, deleteObject } from './sia-client.js';
import {
  rewriteVariantPlaylist,
  rewriteMasterPlaylist,
  parseVariantPlaylist,
  parseMasterPlaylist,
  parseMasterVariants,
} from '../transcode/manifest-rewriter.js';
import {
  buildStorageRecords,
  type StorageRecords,
  type VariantUpload,
} from './artifact-records.js';
import { logger } from '../config/logger.js';

export interface UploadSegmentsResult {
  masterManifestObjectId: string;
  thumbnailObjectIds: string[];
  totalSegments: number;
  totalBytes: number;
  allObjectIds: string[];
  /**
   * Normalized rendition + artifact mapping (each Sia Object ID tied to
   * its asset, rendition, and role). Persisted by the finalize worker.
   */
  storageRecords: StorageRecords;
}

export interface UploadSegmentsOptions {
  /**
   * Local file paths of pre-extracted thumbnails. They go up in the same
   * packed batch as the variant data files.
   */
  thumbnailPaths?: string[];
  onProgress?: (uploaded: number, total: number) => void;
}

/** Packed uploads that make up one asset, used as the progress total. */
const UPLOAD_STAGES = 3;
const DATA_UPLOAD_ATTEMPTS = 5;

/**
 * Upload HLS output to Sia using the byte-range + packed architecture.
 *
 * FFmpeg has been run with `-hls_flags single_file` so each variant has
 * one big data.m4s + a playlist with EXT-X-BYTERANGE references.
 *
 * Every Sia upload sends at least one full slab (all data and parity shards)
 * however little it holds, so the number of uploads, not the bytes, decides
 * how long a short video takes. Each manifest needs the object ids of what it
 * points at, which gives three dependent uploads and no more:
 *
 *   1. every variant data file + the thumbnails, in one packed batch
 *   2. the variant playlists, rewritten to the data object ids
 *   3. the master playlist, rewritten to the playlist object ids
 */
export async function uploadSegments(
  outputDir: string,
  options: UploadSegmentsOptions,
): Promise<UploadSegmentsResult> {
  const { thumbnailPaths = [] } = options;

  const masterContent = await readFile(path.join(outputDir, 'master.m3u8'), 'utf-8');
  const variantPaths = parseMasterPlaylist(masterContent);

  const variants = await Promise.all(
    variantPaths.map(async (variantPath) => {
      const playlistContent = await readFile(path.join(outputDir, variantPath), 'utf-8');
      const parsed = parseVariantPlaylist(playlistContent);
      if (!parsed.dataFilename) {
        throw new Error(
          `variant ${variantPath} has no data file reference (single_file mode expected)`,
        );
      }
      return {
        variantPath,
        playlistContent,
        dataFilename: parsed.dataFilename,
        dataPath: path.join(outputDir, path.dirname(variantPath), parsed.dataFilename),
        segmentCount: parsed.segmentCount,
      };
    }),
  );

  let uploadedStages = 0;
  const stageDone = () => {
    uploadedStages += 1;
    options.onProgress?.(uploadedStages, UPLOAD_STAGES);
  };
  const allObjectIds: string[] = [];

  // Everything from here on pins objects on Sia. If any step fails, this
  // whole stage is retried by BullMQ from scratch and would re-pin every
  // object, orphaning the ones pinned this attempt. So on failure we unpin
  // what we pinned before rethrowing, keeping the retry clean.
  try {
    // ── 1. variant data files + thumbnails ──────────────────────────
    const dataSources = [
      ...variants.map((v) => ({ path: v.dataPath })),
      ...thumbnailPaths.map((p) => ({ path: p })),
    ];
    logger.info(
      { variants: variants.length, thumbnails: thumbnailPaths.length },
      'Uploading variant data and thumbnails to Sia',
    );
    const dataResults = await withRetries('variant data upload', () =>
      uploadAndPinPacked(dataSources),
    );
    allObjectIds.push(...dataResults.map((r) => r.objectId));
    const variantData = dataResults.slice(0, variants.length);
    const thumbnailResults = dataResults.slice(variants.length);
    stageDone();

    // ── 2. variant playlists ────────────────────────────────────────
    const rewrittenPlaylists = variants.map((v, i) =>
      new TextEncoder().encode(
        rewriteVariantPlaylist(
          v.playlistContent,
          { dataObjectId: variantData[i].objectId, dataFilename: v.dataFilename },
          '',
        ),
      ),
    );
    const playlistResults = await uploadAndPinPacked(rewrittenPlaylists);
    allObjectIds.push(...playlistResults.map((r) => r.objectId));
    stageDone();

    const variantObjectMap = new Map<string, string>();
    variants.forEach((v, i) => {
      variantObjectMap.set(v.variantPath, playlistResults[i].objectId);
      logger.info(
        {
          variantPath: v.variantPath,
          dataObjectId: variantData[i].objectId,
          playlistObjectId: playlistResults[i].objectId,
          segments: v.segmentCount,
        },
        'Variant uploaded',
      );
    });

    // ── 3. master playlist ──────────────────────────────────────────
    const masterBytes = new TextEncoder().encode(
      rewriteMasterPlaylist(masterContent, variantObjectMap, ''),
    );
    const masterResult = await uploadAndPin(masterBytes);
    allObjectIds.push(masterResult.objectId);
    stageDone();

    // renditions are segmented identically, so the asset's segment count is
    // the per-rendition count, not the sum across renditions
    const totalSegments = Math.max(0, ...variants.map((v) => v.segmentCount));
    const totalBytes =
      dataResults.reduce((n, r) => n + r.size, 0) +
      playlistResults.reduce((n, r) => n + r.size, 0) +
      masterResult.size;

    logger.info(
      {
        masterObjectId: masterResult.objectId,
        thumbnailCount: thumbnailResults.length,
        totalSegments,
        totalBytes,
      },
      'Master manifest uploaded to Sia',
    );

    // ── Assemble the normalized rendition + artifact mapping ────────────
    // Each Sia Object ID is tied to its asset, rendition, and role. The
    // per-variant resolution/bitrate comes from the master's STREAM-INF
    // lines; everything else was captured during upload above.
    const variantMetaByPath = new Map(parseMasterVariants(masterContent).map((v) => [v.path, v]));
    const variantUploads: VariantUpload[] = variants.map((v, i) => {
      const meta = variantMetaByPath.get(v.variantPath);
      return {
        name: path.dirname(v.variantPath),
        width: meta?.width ?? null,
        height: meta?.height ?? null,
        videoBitrateKbps: meta?.bandwidthKbps ?? null,
        segmentCount: v.segmentCount,
        dataObjectId: variantData[i].objectId,
        dataByteSize: variantData[i].size,
        playlistObjectId: playlistResults[i].objectId,
        playlistByteSize: playlistResults[i].size,
      };
    });

    const storageRecords = buildStorageRecords({
      variants: variantUploads,
      thumbnails: thumbnailResults.map((r) => ({ objectId: r.objectId, byteSize: r.size })),
      master: { objectId: masterResult.objectId, byteSize: masterResult.size },
    });

    return {
      masterManifestObjectId: masterResult.objectId,
      thumbnailObjectIds: thumbnailResults.map((r) => r.objectId),
      totalSegments,
      totalBytes,
      allObjectIds,
      storageRecords,
    };
  } catch (err) {
    if (allObjectIds.length > 0) {
      logger.warn(
        { count: allObjectIds.length, err },
        'upload-segments failed; unpinning objects pinned this attempt to avoid orphans',
      );
      for (const id of allObjectIds) {
        try {
          await deleteObject(id);
        } catch (cleanupErr) {
          logger.warn({ objectId: id, cleanupErr }, 'cleanup unpin failed');
        }
      }
    }
    throw err;
  }
}

/**
 * The data upload is the big one and the most exposed to slow or flaky
 * hosts, so it gets a few quick retries before the whole job is failed back
 * to BullMQ.
 */
async function withRetries<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < DATA_UPLOAD_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === DATA_UPLOAD_ATTEMPTS - 1) break;
      const delay = 2000 * Math.pow(2, attempt);
      logger.warn({ attempt: attempt + 1, delay, err }, `${label} failed, retrying`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error(
    `${label} failed after ${DATA_UPLOAD_ATTEMPTS} attempts: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}
