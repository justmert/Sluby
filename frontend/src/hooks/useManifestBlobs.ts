import { useQuery } from '@tanstack/react-query';
import { siaObjectUrl } from '@/lib/sia';

export interface VariantObjects {
  name: string;              // e.g. "1080p"
  playlistObjectId: string;
  initObjectId: string | null;
  segmentObjectIds: string[];
}

export interface ManifestObjectMap {
  masterObjectId: string;
  variants: VariantObjects[];
  totalObjects: number;
  allObjectIds: string[];
}

// Extract object ID from a Sia renterd URL
function extractObjectId(url: string): string | null {
  const match = url.match(/\/v1\/objects\/([A-Za-z0-9_/-]+)/);
  return match ? match[1] : null;
}

// Parse the master manifest to get variant playlist object IDs
function parseMasterManifest(content: string): { name: string; objectId: string }[] {
  const lines = content.split('\n');
  const variants: { name: string; objectId: string }[] = [];
  let currentName = '';

  for (const line of lines) {
    const trimmed = line.trim();
    // Extract resolution/name from #EXT-X-STREAM-INF
    const nameMatch = trimmed.match(/NAME="([^"]+)"/);
    if (nameMatch) {
      currentName = nameMatch[1];
      continue;
    }
    // Also try RESOLUTION
    const resMatch = trimmed.match(/RESOLUTION=(\d+x\d+)/);
    if (resMatch && !currentName) {
      currentName = resMatch[1];
    }
    // Non-comment, non-empty line after #EXT-X-STREAM-INF is the URL
    if (!trimmed.startsWith('#') && trimmed !== '') {
      const objectId = extractObjectId(trimmed);
      if (objectId) {
        variants.push({ name: currentName || `Variant ${variants.length + 1}`, objectId });
        currentName = '';
      }
    }
  }
  return variants;
}

// Parse a variant playlist to get init segment and media segment object IDs
function parseVariantPlaylist(content: string): { initObjectId: string | null; segmentObjectIds: string[] } {
  const lines = content.split('\n');
  let initObjectId: string | null = null;
  const segmentObjectIds: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Init segment: #EXT-X-MAP:URI="https://renterd.../v1/objects/..."
    const initMatch = trimmed.match(/#EXT-X-MAP:URI="([^"]+)"/);
    if (initMatch) {
      initObjectId = extractObjectId(initMatch[1]);
      continue;
    }

    // Skip comments and empty lines
    if (trimmed.startsWith('#') || trimmed === '') continue;

    // Segment URL lines
    const objectId = extractObjectId(trimmed);
    if (objectId) {
      segmentObjectIds.push(objectId);
    }
  }

  return { initObjectId, segmentObjectIds };
}

async function fetchManifestObjects(masterObjectId: string): Promise<ManifestObjectMap> {
  // Fetch master manifest
  const masterRes = await fetch(siaObjectUrl(masterObjectId));
  if (!masterRes.ok) throw new Error('Failed to fetch master manifest');
  const masterContent = await masterRes.text();

  // Parse variant playlist references
  const variantRefs = parseMasterManifest(masterContent);

  // Fetch each variant playlist in parallel
  const variants: VariantObjects[] = await Promise.all(
    variantRefs.map(async (ref) => {
      try {
        const res = await fetch(siaObjectUrl(ref.objectId));
        if (!res.ok) throw new Error(`Failed to fetch variant ${ref.name}`);
        const content = await res.text();
        const parsed = parseVariantPlaylist(content);

        return {
          name: ref.name,
          playlistObjectId: ref.objectId,
          initObjectId: parsed.initObjectId,
          segmentObjectIds: parsed.segmentObjectIds,
        };
      } catch {
        return {
          name: ref.name,
          playlistObjectId: ref.objectId,
          initObjectId: null,
          segmentObjectIds: [],
        };
      }
    })
  );

  // Collect all object IDs in order and count
  const allObjectIds: string[] = [masterObjectId];
  for (const v of variants) {
    allObjectIds.push(v.playlistObjectId);
    if (v.initObjectId) allObjectIds.push(v.initObjectId);
    allObjectIds.push(...v.segmentObjectIds);
  }

  return { masterObjectId, variants, totalObjects: allObjectIds.length, allObjectIds };
}

export function useManifestObjects(masterObjectId: string | null | undefined) {
  return useQuery({
    queryKey: ['manifest-objects', masterObjectId],
    queryFn: () => fetchManifestObjects(masterObjectId!),
    enabled: !!masterObjectId,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
  });
}
