import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { uploadAndPin, uploadAndPinPacked, deleteObject } from './sia-client.js';
import {
  rewriteVariantPlaylist,
  rewriteMasterPlaylist,
  parseVariantPlaylist,
  parseMasterPlaylist,
  parseMasterVariants,
  type SegmentBlobMapping,
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
   * Local file paths of pre-extracted thumbnails. These are uploaded in
   * the same packed Sia batch as the variant playlists to minimize host
   * stream count.
   */
  thumbnailPaths?: string[];
  onProgress?: (uploaded: number, total: number) => void;
  concurrency?: number;
}

/**
 * Upload HLS output to Sia using the byte-range + packed architecture.
 *
 * FFmpeg has been run with `-hls_flags single_file` so each variant has
 * one big data.m4s + a playlist with EXT-X-BYTERANGE references. We:
 *
 *   1. Upload each variant's data.m4s in parallel via uploadAndPin
 *      (one large file per variant — naturally fills its own slab).
 *   2. Rewrite each variant playlist to point its data references at
 *      the gateway URL of the uploaded data file.
 *   3. Pack the variant playlists + thumbnails into ONE uploadPacked
 *      batch. Many small items share a slab → drastic reduction in
 *      host stream count vs. uploading each separately.
 *   4. Rewrite the master playlist to point variant references at the
 *      packed playlist object IDs.
 *   5. Upload the master separately (must come last — depends on the
 *      packed batch's output IDs).
 *
 * Total Sia network operations:
 *   N variants (data files)  +  1 packed batch  +  1 master
 *   = N + 2 (was 2N + 1 + thumbnails before this refactor)
 *
 * For the typical 4-rung ladder + 3 thumbnails: 4 + 1 + 1 = 6 ops vs. 12.
 */
export async function uploadSegments(
  outputDir: string,
  options: UploadSegmentsOptions,
): Promise<UploadSegmentsResult> {
  const envConcurrency = process.env.SIA_UPLOAD_CONCURRENCY
    ? parseInt(process.env.SIA_UPLOAD_CONCURRENCY, 10)
    : undefined;
  const { concurrency = envConcurrency ?? 3, thumbnailPaths = [] } = options;

  const masterPath = path.join(outputDir, 'master.m3u8');
  const masterContent = await readFile(masterPath, 'utf-8');
  const variantPaths = parseMasterPlaylist(masterContent);

  // Total Sia operations for progress tracking:
  //   variants (data) + packed-batch + master
  // Treat packed batch as a single op for progress UI; the actual
  // progress jumps from "variants done" to "packed done" to "master done".
  const totalFiles = variantPaths.length + 2;
  let uploadedFiles = 0;
  let totalBytes = 0;
  let totalSegments = 0;
  const allObjectIds: string[] = [];

  // Everything from here on pins objects on Sia. If any step fails, this
  // whole stage is retried by BullMQ from scratch and would re-pin every
  // object, orphaning the ones pinned this attempt. So on failure we unpin
  // what we pinned before rethrowing, keeping the retry clean.
  try {
    // ── 1. Upload data files in parallel ────────────────────────────
    /** Read data file + upload + return mapping for playlist rewriting. */
    async function uploadVariantData(variantPath: string): Promise<{
      variantPath: string;
      playlistContent: string;
      mapping: SegmentBlobMapping;
      bytesUploaded: number;
      segmentCount: number;
      dataObjectId: string;
    }> {
      const variantDir = path.join(outputDir, path.dirname(variantPath));
      const playlistFsPath = path.join(outputDir, variantPath);
      const playlistContent = await readFile(playlistFsPath, 'utf-8');
      const parsed = parseVariantPlaylist(playlistContent);

      if (!parsed.dataFilename) {
        throw new Error(
          `variant ${variantPath} has no data file reference (single_file mode expected)`,
        );
      }

      const dataPath = path.join(variantDir, parsed.dataFilename);
      const dataBytes = await readFile(dataPath);

      logger.info(
        {
          variantPath,
          dataSize: dataBytes.length,
          segments: parsed.segmentCount,
        },
        'Uploading variant data file to Sia',
      );

      let dataObjectId = '';
      let lastErr: unknown;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          const result = await uploadAndPin(new Uint8Array(dataBytes));
          dataObjectId = result.objectId;
          break;
        } catch (err) {
          lastErr = err;
          const delay = 2000 * Math.pow(2, attempt);
          logger.warn(
            { variantPath, attempt: attempt + 1, delay, err },
            'Variant data upload failed, retrying',
          );
          await new Promise((r) => setTimeout(r, delay));
        }
      }
      if (!dataObjectId) {
        throw new Error(
          `variant ${variantPath} data upload failed after retries: ${
            lastErr instanceof Error ? lastErr.message : String(lastErr)
          }`,
        );
      }

      return {
        variantPath,
        playlistContent,
        mapping: { dataObjectId, dataFilename: parsed.dataFilename },
        bytesUploaded: dataBytes.length,
        segmentCount: parsed.segmentCount,
        dataObjectId,
      };
    }

    // Run in parallel batches.
    const variantInfos: Awaited<ReturnType<typeof uploadVariantData>>[] = [];
    for (let i = 0; i < variantPaths.length; i += concurrency) {
      const batch = variantPaths.slice(i, i + concurrency);
      const results = await Promise.allSettled(batch.map(uploadVariantData));
      for (const r of results) {
        if (r.status !== 'fulfilled') {
          logger.error({ error: r.reason }, 'Variant data upload permanently failed');
          throw r.reason;
        }
        variantInfos.push(r.value);
        allObjectIds.push(r.value.dataObjectId);
        totalBytes += r.value.bytesUploaded;
        // Renditions are segmented identically, so the asset's segment count is
        // the per-rendition count, not the sum across renditions.
        totalSegments = Math.max(totalSegments, r.value.segmentCount);
        uploadedFiles += 1;
        options.onProgress?.(uploadedFiles, totalFiles);
      }
      if (i + concurrency < variantPaths.length) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    // ── 2. Rewrite variant playlists, prepare thumbnails ────────────
    const rewrittenPlaylists = variantInfos.map((info) =>
      new TextEncoder().encode(rewriteVariantPlaylist(info.playlistContent, info.mapping, '')),
    );

    const thumbnailBuffers: Uint8Array[] = [];
    for (const tp of thumbnailPaths) {
      const buf = await readFile(tp);
      thumbnailBuffers.push(new Uint8Array(buf));
    }

    // ── 3. ONE packed Sia upload for [variant playlists + thumbnails] ─
    // Order is important — playlists first, thumbnails after — so we can
    // index into the result array deterministically.
    const packedItems: Uint8Array[] = [...rewrittenPlaylists, ...thumbnailBuffers];
    let packedResults: Awaited<ReturnType<typeof uploadAndPinPacked>> = [];
    if (packedItems.length > 0) {
      packedResults = await uploadAndPinPacked(packedItems);
      // The playlist→variant and thumbnail mappings below index into the result
      // positionally, which requires the packed upload to return one result per
      // input in add() order. A count mismatch means that contract broke; fail
      // loudly rather than silently mis-map a variant to a thumbnail.
      if (packedResults.length !== packedItems.length) {
        throw new Error(
          `packed upload returned ${packedResults.length} results for ${packedItems.length} items`,
        );
      }
      for (const r of packedResults) {
        allObjectIds.push(r.objectId);
        totalBytes += r.size;
      }
      uploadedFiles += 1; // count the whole pack as one progress op
      options.onProgress?.(uploadedFiles, totalFiles);
    }

    const playlistResults = packedResults.slice(0, rewrittenPlaylists.length);
    const thumbnailResults = packedResults.slice(rewrittenPlaylists.length);
    const thumbnailObjectIds = thumbnailResults.map((r) => r.objectId);

    // Build variant→playlistObjectId map for the master rewrite.
    const variantObjectMap = new Map<string, string>();
    for (let i = 0; i < variantInfos.length; i++) {
      variantObjectMap.set(variantInfos[i].variantPath, playlistResults[i].objectId);
    }

    for (let i = 0; i < variantInfos.length; i++) {
      logger.info(
        {
          variantPath: variantInfos[i].variantPath,
          dataObjectId: variantInfos[i].dataObjectId,
          playlistObjectId: playlistResults[i].objectId,
          segments: variantInfos[i].segmentCount,
        },
        'Variant uploaded',
      );
    }

    // ── 4. Rewrite + upload master playlist ─────────────────────────
    const rewrittenMaster = rewriteMasterPlaylist(masterContent, variantObjectMap, '');
    const masterBytes = new TextEncoder().encode(rewrittenMaster);
    const masterResult = await uploadAndPin(masterBytes);
    allObjectIds.push(masterResult.objectId);
    totalBytes += masterBytes.length;
    uploadedFiles += 1;
    options.onProgress?.(uploadedFiles, totalFiles);

    logger.info(
      {
        masterObjectId: masterResult.objectId,
        thumbnailCount: thumbnailObjectIds.length,
        totalSegments,
        totalBytes,
        siaOperations: variantInfos.length + (packedItems.length > 0 ? 1 : 0) + 1,
      },
      'Master manifest uploaded to Sia',
    );

    // ── Assemble the normalized rendition + artifact mapping ────────────
    // Each Sia Object ID is tied to its asset, rendition, and role. The
    // per-variant resolution/bitrate comes from the master's STREAM-INF
    // lines; everything else was captured during upload above.
    const variantMetaByPath = new Map(parseMasterVariants(masterContent).map((v) => [v.path, v]));
    const variantUploads: VariantUpload[] = variantInfos.map((info, i) => {
      const meta = variantMetaByPath.get(info.variantPath);
      return {
        name: path.dirname(info.variantPath),
        width: meta?.width ?? null,
        height: meta?.height ?? null,
        videoBitrateKbps: meta?.bandwidthKbps ?? null,
        segmentCount: info.segmentCount,
        dataObjectId: info.dataObjectId,
        dataByteSize: info.bytesUploaded,
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
      thumbnailObjectIds,
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
