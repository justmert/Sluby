import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { uploadAndPinPacked, pruneSlabs, type PackedSource } from './sia-client.js';
import type { ObjectLedger } from './object-ledger.js';
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
  /**
   * Gets every object id before its pin, and back the ones this upload pinned
   * when it fails or is stopped, so no pinned object goes unrecorded.
   */
  ledger: ObjectLedger;
  /** Runs before each upload; a throw stops the upload (its asset was deleted). */
  checkpoint?: () => Promise<void>;
}

/** Packed uploads that make up one asset, used as the progress total. */
const UPLOAD_STAGES = 3;
const DATA_UPLOAD_ATTEMPTS = 5;

/**
 * Upload a finished transcode to Sia. ffmpeg ran with `single_file`, so each
 * variant is one data file plus a playlist that addresses it by byte range.
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
  const { thumbnailPaths = [], ledger } = options;
  const { masterContent, variants } = await readTranscodeOutput(outputDir);

  let uploadedStages = 0;
  const stageDone = () => {
    uploadedStages += 1;
    options.onProgress?.(uploadedStages, UPLOAD_STAGES);
  };
  const allObjectIds: string[] = [];
  // every id handed to the ledger, including ones whose pin then failed
  const recorded: string[] = [];

  const checkpoint = async () => options.checkpoint?.();
  const upload = async (items: PackedSource[]) => {
    let attemptIds: string[] = [];
    try {
      return await uploadAndPinPacked(items, {
        beforePin: async (ids) => {
          await ledger.record(ids);
          attemptIds = ids;
          recorded.push(...ids);
        },
      });
    } catch (err) {
      // a failed pin leaves recorded ids that the retry below will not use
      await ledger.release(attemptIds);
      throw err;
    }
  };

  try {
    // data files first, since each playlist names its data object
    const dataSources = [
      ...variants.map((v) => ({ path: v.dataPath })),
      ...thumbnailPaths.map((p) => ({ path: p })),
    ];
    logger.info(
      { variants: variants.length, thumbnails: thumbnailPaths.length },
      'Uploading variant data and thumbnails to Sia',
    );
    const dataResults = await withRetries('variant data upload', checkpoint, () =>
      upload(dataSources),
    );
    allObjectIds.push(...dataResults.map((r) => r.objectId));
    const variantData = dataResults.slice(0, variants.length);
    const thumbnailResults = dataResults.slice(variants.length);
    stageDone();

    // then the playlists, which the master names in turn
    const rewrittenPlaylists = variants.map((v, i) =>
      new TextEncoder().encode(
        rewriteVariantPlaylist(
          v.playlistContent,
          { dataObjectId: variantData[i].objectId, dataFilename: v.dataFilename },
          '',
        ),
      ),
    );
    await checkpoint();
    const playlistResults = await upload(rewrittenPlaylists);
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

    const masterBytes = new TextEncoder().encode(
      rewriteMasterPlaylist(masterContent, variantObjectMap, ''),
    );
    await checkpoint();
    const [masterResult] = await upload([masterBytes]);
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

    // the master's STREAM-INF lines give each variant's resolution and
    // bitrate; everything else was captured during the uploads above
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
    // a retry of the stage uploads everything again, so nothing of this
    // attempt is kept; what cannot be unpinned now stays marked for release
    if (recorded.length > 0) {
      logger.warn(
        { count: recorded.length, err },
        'upload-segments stopped; releasing the objects this attempt pinned',
      );
      await ledger.release(recorded);
      pruneSlabs().catch((pruneErr: unknown) => {
        logger.warn({ err: pruneErr }, 'Slab prune after a stopped upload failed');
      });
    }
    throw err;
  }
}

interface TranscodedVariant {
  variantPath: string;
  playlistContent: string;
  dataFilename: string;
  dataPath: string;
  segmentCount: number;
}

/**
 * Read and check the transcode output before anything is pinned. A master
 * without variants, or a variant playlist without segments or without its
 * end tag, is the leftover of a failed FFmpeg run and must never be
 * published as a video.
 */
async function readTranscodeOutput(
  outputDir: string,
): Promise<{ masterContent: string; variants: TranscodedVariant[] }> {
  const masterContent = await readFile(path.join(outputDir, 'master.m3u8'), 'utf-8');
  const variantPaths = parseMasterPlaylist(masterContent);
  if (variantPaths.length === 0) {
    throw new Error(`${outputDir}/master.m3u8 lists no variant playlists`);
  }

  const variants = await Promise.all(
    variantPaths.map(async (variantPath) => {
      const playlistContent = await readFile(path.join(outputDir, variantPath), 'utf-8');
      const parsed = parseVariantPlaylist(playlistContent);
      if (!parsed.dataFilename) {
        throw new Error(
          `variant ${variantPath} has no data file reference (single_file mode expected)`,
        );
      }
      if (parsed.segmentCount === 0) throw new Error(`variant ${variantPath} has no segments`);
      if (!/^#EXT-X-ENDLIST\s*$/m.test(playlistContent)) {
        throw new Error(`variant ${variantPath} is not finished (no #EXT-X-ENDLIST)`);
      }
      const dataPath = path.join(outputDir, path.dirname(variantPath), parsed.dataFilename);
      if ((await stat(dataPath)).size === 0) throw new Error(`${dataPath} is empty`);
      return {
        variantPath,
        playlistContent,
        dataFilename: parsed.dataFilename,
        dataPath,
        segmentCount: parsed.segmentCount,
      };
    }),
  );
  return { masterContent, variants };
}

/**
 * The data upload is the big one and the most exposed to slow or flaky
 * hosts, so it gets a few quick retries before the whole job is failed back
 * to BullMQ. The checkpoint runs before every attempt but outside the
 * retry, so a stopped stage ends at once with its own error.
 */
async function withRetries<T>(
  label: string,
  checkpoint: () => Promise<void>,
  fn: () => Promise<T>,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < DATA_UPLOAD_ATTEMPTS; attempt++) {
    await checkpoint();
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
