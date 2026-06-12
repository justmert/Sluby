/**
 * Rewrites HLS M3U8 manifests to replace local file references with Sia object IDs.
 *
 * After segments are uploaded to Sia, each local filename (e.g., seg_0000.m4s)
 * must be replaced with the renterd URL serving that object ID.
 */

export interface SegmentBlobMapping {
  /** Local filename → Sia object ID */
  segments: Map<string, string>;
  /** Init segment Sia object ID */
  initObjectId: string;
}

/**
 * Rewrite a variant playlist (e.g., 1080p/playlist.m3u8) to reference Sia object IDs.
 *
 * Replaces:
 * - #EXT-X-MAP:URI="init.mp4" → #EXT-X-MAP:URI="{baseUrl}/v1/objects/{initObjectId}"
 * - seg_0000.m4s → {baseUrl}/v1/objects/{segmentObjectId}
 */
export function rewriteVariantPlaylist(
  playlistContent: string,
  mapping: SegmentBlobMapping,
  baseUrl: string,
): string {
  let rewritten = playlistContent;

  // Rewrite init segment URI
  rewritten = rewritten.replace(
    /#EXT-X-MAP:URI="([^"]+)"/g,
    `#EXT-X-MAP:URI="${baseUrl}/v1/objects/${mapping.initObjectId}"`,
  );

  // Rewrite each segment reference
  for (const [filename, objectId] of mapping.segments) {
    // Segment lines are bare filenames on their own line
    rewritten = rewritten.replace(
      new RegExp(`^${escapeRegex(filename)}$`, 'gm'),
      `${baseUrl}/v1/objects/${objectId}`,
    );
  }

  return rewritten;
}

/**
 * Rewrite the master playlist to reference Sia object IDs for variant playlists.
 *
 * Replaces:
 * - 1080p/playlist.m3u8 → {baseUrl}/v1/objects/{variantPlaylistObjectId}
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
 * Parse a variant playlist and extract segment filenames and init segment filename.
 */
export function parseVariantPlaylist(content: string): {
  initSegment: string | null;
  segments: string[];
} {
  const lines = content.split('\n');
  let initSegment: string | null = null;
  const segments: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Match init segment: #EXT-X-MAP:URI="init.mp4"
    const initMatch = trimmed.match(/#EXT-X-MAP:URI="([^"]+)"/);
    if (initMatch) {
      initSegment = initMatch[1];
      continue;
    }

    // Skip comments and empty lines
    if (trimmed.startsWith('#') || trimmed === '') {
      continue;
    }

    // Remaining non-comment lines are segment filenames
    if (trimmed.endsWith('.m4s') || trimmed.endsWith('.mp4') || trimmed.endsWith('.ts')) {
      segments.push(trimmed);
    }
  }

  return { initSegment, segments };
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
