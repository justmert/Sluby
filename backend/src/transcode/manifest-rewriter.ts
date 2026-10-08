/**
 * Rewrites the HLS playlists ffmpeg wrote so they name Sia objects instead of
 * local files. With `single_file`, each variant has one data file holding the
 * init section and every segment, and its playlist addresses the segments
 * with EXT-X-BYTERANGE into that file.
 *
 * Every mention of the data file becomes `{baseUrl}/v1/objects/{objectId}`
 * and the byte ranges stay as they are. The pipeline passes an empty base
 * url, so stored playlists hold root-relative paths: they resolve against
 * whichever origin serves the gateway, and the direct-from-Sia player reads
 * the object id out of the path.
 */

export interface SegmentBlobMapping {
  /** The single data file's Sia object ID (init + all segments concatenated). */
  dataObjectId: string;
  /** The data file's local filename as written by FFmpeg (typically "data.m4s"). */
  dataFilename: string;
}

/**
 * Point a variant playlist at its data object: the bare filename on each
 * segment line and the EXT-X-MAP URI, keeping the map's BYTERANGE.
 */
export function rewriteVariantPlaylist(
  playlistContent: string,
  mapping: SegmentBlobMapping,
  baseUrl: string,
): string {
  const dataUrl = `${baseUrl}/v1/objects/${mapping.dataObjectId}`;
  const escFile = escapeRegex(mapping.dataFilename);

  let rewritten = playlistContent;

  rewritten = rewritten.replace(
    new RegExp(`#EXT-X-MAP:URI="${escFile}"`, 'g'),
    `#EXT-X-MAP:URI="${dataUrl}"`,
  );

  rewritten = rewritten.replace(new RegExp(`^${escFile}$`, 'gm'), dataUrl);

  return rewritten;
}

/** Point each variant line of the master playlist at that playlist's object. */
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

/** One variant entry parsed from the master playlist's STREAM-INF lines. */
export interface MasterVariant {
  /** The variant playlist path as written in the master (e.g. "1080p/playlist.m3u8"). */
  path: string;
  width: number | null;
  height: number | null;
  bandwidthKbps: number | null;
}

/**
 * Parse the (un-rewritten) master playlist into per-variant metadata:
 * each `#EXT-X-STREAM-INF` line's RESOLUTION + BANDWIDTH paired with the
 * variant path on the following line. Used to populate `renditions` rows
 * with real dimensions and bitrate.
 */
export function parseMasterVariants(content: string): MasterVariant[] {
  const lines = content.split('\n');
  const out: MasterVariant[] = [];
  let pending: {
    width: number | null;
    height: number | null;
    bandwidthKbps: number | null;
  } | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('#EXT-X-STREAM-INF')) {
      const bw = line.match(/BANDWIDTH=(\d+)/);
      const res = line.match(/RESOLUTION=(\d+)x(\d+)/);
      pending = {
        width: res ? parseInt(res[1], 10) : null,
        height: res ? parseInt(res[2], 10) : null,
        bandwidthKbps: bw ? Math.round(parseInt(bw[1], 10) / 1000) : null,
      };
      continue;
    }
    if (!line || line.startsWith('#')) continue;
    if (pending) {
      out.push({ path: line, ...pending });
      pending = null;
    }
  }

  return out;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
