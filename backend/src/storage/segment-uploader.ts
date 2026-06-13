import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { uploadAndPin } from './sia-client.js';
import {
  rewriteVariantPlaylist,
  rewriteMasterPlaylist,
  parseVariantPlaylist,
  parseMasterPlaylist,
  type SegmentBlobMapping,
} from '../transcode/manifest-rewriter.js';
import { logger } from '../config/logger.js';

export interface UploadSegmentsResult {
  masterManifestObjectId: string;
  totalSegments: number;
  totalBytes: number;
  allObjectIds: string[];
}

export interface UploadSegmentsOptions {
  onProgress?: (uploaded: number, total: number) => void;
  concurrency?: number;
}

/**
 * Upload HLS output to Sia. Architecture is byte-range native — FFmpeg
 * is run with `-hls_flags single_file`, so each variant has ONE big
 * data.m4s containing init + all segments concatenated, plus a playlist
 * with EXT-X-BYTERANGE references into that file.
 *
 * Per video this produces:
 *   - 1 data.m4s per variant      → upload + pin   (4 uploads)
 *   - 1 playlist.m3u8 per variant → rewrite + upload + pin (4 uploads)
 *   - 1 master.m3u8                → rewrite + upload + pin (1 upload)
 * Total: ~9 Sia uploads regardless of video length, vs. ~128 with the
 * per-segment approach. The HTTP gateway translates `Range:` requests on
 * the data files into Sia byte-range downloads.
 *
 * Concurrency: variants upload in parallel up to `concurrency`. Each
 * upload internally fans out to ~12 hosts (3+9 erasure coding) so total
 * host streams = concurrency × 12. For Zen testnet's ~13 hosts the
 * default of 3 keeps the host pool comfortable. Override via
 * SIA_UPLOAD_CONCURRENCY for larger host pools (mainnet).
 */
export async function uploadSegments(
  outputDir: string,
  options: UploadSegmentsOptions,
): Promise<UploadSegmentsResult> {
  const envConcurrency = process.env.SIA_UPLOAD_CONCURRENCY
    ? parseInt(process.env.SIA_UPLOAD_CONCURRENCY, 10)
    : undefined;
  const { concurrency = envConcurrency ?? 3 } = options;

  const masterPath = path.join(outputDir, 'master.m3u8');
  const masterContent = await readFile(masterPath, 'utf-8');
  const variantPaths = parseMasterPlaylist(masterContent);

  // Total Sia operations for progress tracking:
  // (data file + playlist) per variant + master playlist
  const totalFiles = variantPaths.length * 2 + 1;
  let uploadedFiles = 0;
  let totalBytes = 0;
  let totalSegments = 0;
  const allObjectIds: string[] = [];

  /** Upload one variant: data.m4s, then rewrite+upload its playlist. */
  async function uploadVariant(variantPath: string): Promise<{
    variantPath: string;
    playlistObjectId: string;
    segmentsInVariant: number;
    bytesInVariant: number;
    objectIds: string[];
  }> {
    const variantDir = path.join(outputDir, path.dirname(variantPath));
    const playlistPath = path.join(outputDir, variantPath);
    const playlistContent = await readFile(playlistPath, 'utf-8');
    const parsed = parseVariantPlaylist(playlistContent);

    if (!parsed.dataFilename) {
      throw new Error(
        `variant ${variantPath} has no data file reference (single_file mode expected)`,
      );
    }

    const dataPath = path.join(variantDir, parsed.dataFilename);
    const dataBytes = await readFile(dataPath);

    logger.info(
      { variantPath, dataSize: dataBytes.length, segments: parsed.segmentCount },
      'Uploading variant data file to Sia',
    );

    // 1. Upload the single data file (with retry on transient host errors).
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

    // 2. Rewrite playlist to point its data file references at the gateway.
    const mapping: SegmentBlobMapping = {
      dataObjectId,
      dataFilename: parsed.dataFilename,
    };
    const rewritten = rewriteVariantPlaylist(playlistContent, mapping, '');
    const playlistBytes = new TextEncoder().encode(rewritten);

    // 3. Upload the rewritten playlist.
    const playlistResult = await uploadAndPin(playlistBytes);

    logger.info(
      {
        variantPath,
        dataObjectId,
        playlistObjectId: playlistResult.objectId,
        segments: parsed.segmentCount,
      },
      'Variant uploaded',
    );

    return {
      variantPath,
      playlistObjectId: playlistResult.objectId,
      segmentsInVariant: parsed.segmentCount,
      bytesInVariant: dataBytes.length + playlistBytes.length,
      objectIds: [dataObjectId, playlistResult.objectId],
    };
  }

  // Upload variants in parallel batches.
  const variantObjectMap = new Map<string, string>();
  for (let i = 0; i < variantPaths.length; i += concurrency) {
    const batch = variantPaths.slice(i, i + concurrency);
    const results = await Promise.allSettled(batch.map(uploadVariant));

    for (const r of results) {
      if (r.status !== 'fulfilled') {
        logger.error({ error: r.reason }, 'Variant upload permanently failed');
        throw r.reason;
      }
      variantObjectMap.set(r.value.variantPath, r.value.playlistObjectId);
      allObjectIds.push(...r.value.objectIds);
      totalSegments += r.value.segmentsInVariant;
      totalBytes += r.value.bytesInVariant;
      // each successful uploadVariant = 2 Sia operations (data + playlist)
      uploadedFiles += 2;
      options.onProgress?.(uploadedFiles, totalFiles);
    }

    if (i + concurrency < variantPaths.length) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  // Rewrite + upload master playlist last — it references the variant
  // playlist object IDs we just collected.
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
      totalSegments,
      totalBytes,
      siaUploads: allObjectIds.length,
    },
    'Master manifest uploaded to Sia',
  );

  return {
    masterManifestObjectId: masterResult.objectId,
    totalSegments,
    totalBytes,
    allObjectIds,
  };
}
