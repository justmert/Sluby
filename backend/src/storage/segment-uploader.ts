import { readFile, readdir } from 'node:fs/promises';
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
 * Upload all HLS output (segments, init segments, manifests) to Sia.
 *
 * Process:
 * 1. For each variant directory, upload init.mp4 and all seg_NNNN.m4s files
 * 2. Rewrite variant playlists with Sia object IDs
 * 3. Upload rewritten variant playlists
 * 4. Rewrite master playlist with variant playlist object IDs
 * 5. Upload rewritten master playlist
 * 6. Return master manifest object ID
 */
export async function uploadSegments(
  outputDir: string,
  options: UploadSegmentsOptions,
): Promise<UploadSegmentsResult> {
  const { concurrency = 3 } = options;

  // Read master playlist
  const masterPath = path.join(outputDir, 'master.m3u8');
  const masterContent = await readFile(masterPath, 'utf-8');
  const variantPaths = parseMasterPlaylist(masterContent);

  // Count total files to upload for progress tracking
  let totalFiles = 0;
  let uploadedFiles = 0;
  let totalBytes = 0;
  let totalSegments = 0;

  const allObjectIds: string[] = [];

  // Pre-count files
  for (const variantPath of variantPaths) {
    const variantDir = path.join(outputDir, path.dirname(variantPath));
    const files = await readdir(variantDir);
    totalFiles += files.filter(f => f.endsWith('.m4s') || f.endsWith('.mp4')).length;
  }
  // Add variant playlists + master playlist
  totalFiles += variantPaths.length + 1;

  const variantObjectMap = new Map<string, string>();

  // Process each variant
  for (const variantPath of variantPaths) {
    const variantDir = path.join(outputDir, path.dirname(variantPath));
    const playlistPath = path.join(outputDir, variantPath);
    const playlistContent = await readFile(playlistPath, 'utf-8');
    const parsed = parseVariantPlaylist(playlistContent);

    logger.info({ variantPath, segments: parsed.segments.length }, 'Uploading variant segments');

    // Upload init segment
    let initObjectId = '';
    if (parsed.initSegment) {
      const initPath = path.join(variantDir, parsed.initSegment);
      const initData = await readFile(initPath);
      const result = await uploadAndPin(new Uint8Array(initData));
      initObjectId = result.objectId;
      allObjectIds.push(result.objectId);
      totalBytes += initData.length;
      uploadedFiles++;
      options.onProgress?.(uploadedFiles, totalFiles);
    }

    // Upload segments in batches with concurrency control
    const segmentObjectMap = new Map<string, string>();

    for (let i = 0; i < parsed.segments.length; i += concurrency) {
      const batch = parsed.segments.slice(i, i + concurrency);

      const results = await Promise.allSettled(
        batch.map(async (segFilename) => {
          const segPath = path.join(variantDir, segFilename);
          const segData = await readFile(segPath);
          totalBytes += segData.length;

          let retries = 0;
          const maxRetries = 5;

          while (retries < maxRetries) {
            try {
              const result = await uploadAndPin(new Uint8Array(segData));
              return { filename: segFilename, objectId: result.objectId };
            } catch (err) {
              retries++;
              if (retries >= maxRetries) throw err;
              const delay = 2000 * Math.pow(2, retries);
              logger.warn({ segFilename, retries, delay, err }, 'Segment upload failed, retrying');
              await new Promise(r => setTimeout(r, delay));
            }
          }
          throw new Error('Unreachable');
        }),
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          segmentObjectMap.set(result.value.filename, result.value.objectId);
          allObjectIds.push(result.value.objectId);
          totalSegments++;
          uploadedFiles++;
          options.onProgress?.(uploadedFiles, totalFiles);
        } else {
          logger.error({ error: result.reason }, 'Segment upload permanently failed');
          throw result.reason;
        }
      }

      // Brief pause between batches to avoid rate limiting from Sia
      if (i + concurrency < parsed.segments.length) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    // Rewrite and upload variant playlist
    const mapping: SegmentBlobMapping = { segments: segmentObjectMap, initObjectId };
    const rewrittenPlaylist = rewriteVariantPlaylist(playlistContent, mapping, '');
    const playlistData = new TextEncoder().encode(rewrittenPlaylist);
    const playlistResult = await uploadAndPin(playlistData);
    variantObjectMap.set(variantPath, playlistResult.objectId);
    allObjectIds.push(playlistResult.objectId);
    totalBytes += playlistData.length;
    uploadedFiles++;
    options.onProgress?.(uploadedFiles, totalFiles);

    logger.info({
      variantPath,
      segments: segmentObjectMap.size,
      playlistObjectId: playlistResult.objectId,
    }, 'Variant uploaded');
  }

  // Rewrite and upload master playlist
  const rewrittenMaster = rewriteMasterPlaylist(masterContent, variantObjectMap, '');
  const masterData = new TextEncoder().encode(rewrittenMaster);
  const masterResult = await uploadAndPin(masterData);
  allObjectIds.push(masterResult.objectId);
  uploadedFiles++;
  options.onProgress?.(uploadedFiles, totalFiles);

  logger.info({
    masterObjectId: masterResult.objectId,
    totalSegments,
    totalBytes,
  }, 'Master manifest uploaded to Sia');

  return {
    masterManifestObjectId: masterResult.objectId,
    totalSegments,
    totalBytes,
    allObjectIds,
  };
}
