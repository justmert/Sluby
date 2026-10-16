import { Layers } from 'lucide-react';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { ObjectIdBadge } from '@/components/shared/ObjectIdBadge';
import { useAssetRenditions, type Rendition } from '@/hooks/asset-detail-queries';
import {
  formatBitrate,
  formatBytes,
  formatCount,
  formatResolution,
  NO_VALUE,
} from '@/lib/formatters';

// bitrate and segments give way first when the page is narrow, so the file
// columns stay on screen (A11Y-30); phones show every field in the row card
const NARROW_HIDDEN = 'hidden @3xl/page:table-cell';

/** The qualities the transcoder made for one video, with their files on Sia. */
export function RenditionsTable({ assetId }: { assetId: string }) {
  const renditions = useAssetRenditions(assetId, true);
  return (
    <section aria-label="Renditions" className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        The qualities made from your video, up to its original resolution
      </p>
      <DataTable<Rendition>
        caption="Renditions"
        rows={renditions.data?.data}
        loadingRows={3}
        getRowId={(r) => r.name}
        getRowLabel={(r) => r.name}
        error={renditions.error}
        onRetry={renditions.refetch}
        retrying={renditions.isFetching}
        what="the quality list"
        empty={
          <EmptyState
            icon={Layers}
            title="No quality list"
            description="Videos uploaded before this was recorded show their files on the Sia storage tab."
          />
        }
        columns={[
          { id: 'name', header: 'Quality', primary: true, cell: (r) => r.name },
          {
            id: 'resolution',
            header: 'Resolution',
            className: 'tabular-nums',
            cell: (r) => formatResolution(r.width, r.height ?? undefined),
          },
          {
            id: 'bitrate',
            header: 'Video bitrate',
            align: 'right',
            className: NARROW_HIDDEN,
            cell: (r) =>
              r.video_bitrate_kbps ? formatBitrate(r.video_bitrate_kbps * 1000) : NO_VALUE,
          },
          {
            id: 'segments',
            header: 'Segments',
            align: 'right',
            className: NARROW_HIDDEN,
            cell: (r) => formatCount(r.segment_count),
          },
          { id: 'size', header: 'Size', align: 'right', cell: (r) => formatBytes(r.byte_size) },
          {
            id: 'playlist',
            header: 'Playlist file',
            cell: (r) => (
              <ObjectIdBadge
                value={r.playlist_object_id}
                truncate={6}
                copyLabel={`Copy playlist file ID for ${r.name}`}
              />
            ),
          },
          {
            id: 'media',
            header: 'Video file',
            cell: (r) => (
              <ObjectIdBadge
                value={r.data_object_id}
                truncate={6}
                copyLabel={`Copy video file ID for ${r.name}`}
              />
            ),
          },
        ]}
      />
    </section>
  );
}
