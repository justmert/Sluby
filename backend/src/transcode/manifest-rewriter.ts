/**
 * Rewrites HLS M3U8 manifests to replace local file references with Sia
 * gateway URLs. With FFmpeg's `single_file` flag, each variant has ONE
 * data.m4s containing init+all segments concatenated, and the playlist
 * references segments via EXT-X-BYTERANGE pointing into that file.
 *
 * Rewriting strategy:
 *   - The single data file's filename (e.g. `data.m4s`) is replaced with
 *     `{baseUrl}/v1/objects/{dataObjectId}` everywhere it appears.
 *   - The EXT-X-MAP:URI="data.m4s",BYTERANGE="..." line is rewritten to
 *     point to the same gateway URL — the BYTERANGE attribute is preserved.
 *   - All EXT-X-BYTERANGE:length@offset lines are kept verbatim — the
 *     gateway translates HTTP `Range:` headers into Sia byte-range
 *     downloads on the way out.
 */

export interface SegmentBlobMapping {
  /** The single data file's Sia object ID (init + all segments concatenated). */
  dataObjectId: string;
  /** The data file's local filename as written by FFmpeg (typically "data.m4s"). */
  dataFilename: string;
}

/**
 * Rewrite a variant playlist to reference the Sia gateway URL for its
 * single data file.
 *
 * Replaces `data.m4s` (bare filename, on its own line per HLS spec) with
 * `{baseUrl}/v1/objects/{dataObjectId}`. Rewrites the
 * `#EXT-X-MAP:URI="data.m4s",BYTERANGE="..."` line to the same URL while
 * preserving the BYTERANGE attribute.
 */
export function rewriteVariantPlaylist(
  playlistContent: string,
  mapping: SegmentBlobMapping,
  baseUrl: string,
): string {
  const dataUrl = `${baseUrl}/v1/objects/${mapping.dataObjectId}`;
  const escFile = escapeRegex(mapping.dataFilename);

  let rewritten = playlistContent;

  // Rewrite EXT-X-MAP URI; preserve any other attributes (e.g. BYTERANGE).
  rewritten = rewritten.replace(
    new RegExp(`#EXT-X-MAP:URI="${escFile}"`, 'g'),
    `#EXT-X-MAP:URI="${dataUrl}"`,
  );

  // Rewrite bare-filename segment lines (the URI line that follows each
  // EXT-X-BYTERANGE entry).
  rewritten = rewritten.replace(
    new RegExp(`^${escFile}$`, 'gm'),
    dataUrl,
  );

  return rewritten;
}

/**
 * Rewrite the master playlist to reference Sia object IDs for variant
 * playlists.
 */
export function rewriteMasterPlaylist(
  masterContent: string,
  variantBlobMap: Map<string, string>,
  baseUrl: string,
): string {
  let rewritten = masterContent;

  for (const [variantPath, objectId] of variantBlobMap) {
    rewritten = rewritten.replace(
      new RegExp(`^${escapeRegex(variantPath)}$`, 'gm'),
      `${baseUrl}/v1/objects/${objectId}`,
    );
  }

  return rewritten;
}

/**
 * Parse a variant playlist (single_file form) and extract:
 *  - The data filename (the single .m4s the EXT-X-MAP and segment lines
 *    reference; typically "data.m4s").
 *  - Number of EXTINF segment entries (informational).
 */
export function parseVariantPlaylist(content: string): {
  dataFilename: string | null;
  segmentCount: number;
} {
  const lines = content.split('\n');
  let dataFilename: string | null = null;
  let segmentCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // EXT-X-MAP:URI="data.m4s",BYTERANGE="..."  → capture filename
    const mapMatch = trimmed.match(/#EXT-X-MAP:URI="([^"]+)"/);
    if (mapMatch && !dataFilename) {
      dataFilename = mapMatch[1];
      continue;
    }

    if (trimmed.startsWith('#EXTINF:')) {
      segmentCount++;
      continue;
    }

    // The bare-filename line right after each EXT-X-BYTERANGE
    if (trimmed.endsWith('.m4s') || trimmed.endsWith('.mp4') || trimmed.endsWith('.ts')) {
      if (!dataFilename) dataFilename = trimmed;
    }
  }

  return { dataFilename, segmentCount };
}

/**
 * Parse the master playlist and extract variant playlist paths.
 */
export function parseMasterPlaylist(content: string): string[] {
  const lines = content.split('\n');
  const variantPaths: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || trimmed === '') continue;
    if (trimmed.endsWith('.m3u8')) {
      variantPaths.push(trimmed);
    }
  }

  return variantPaths;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
