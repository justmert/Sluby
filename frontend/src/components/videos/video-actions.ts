import { Globe, Lock } from 'lucide-react';
import type { AccessTier, VideoAsset } from '@sluby/sdk';
import type { RowAction } from '@/components/shared/DataTable';
import { primaryEmbed, streamUrl } from '@/lib/embed';
import { Icons } from '@/lib/icons';
import { toastError, toastSuccess } from '@/lib/toast';

/** Copies a value and says so in a toast, or says why it could not. */
export async function copyWithToast(value: string, done: string) {
  try {
    await navigator.clipboard.writeText(value);
    toastSuccess(done);
  } catch {
    // the clipboard needs a secure context and the page's focus
    toastError('Could not copy. Your browser blocked the clipboard');
  }
}

export interface VideoActionHandlers {
  open: (asset: VideoAsset) => void;
  preview: (asset: VideoAsset) => void;
  delete: (asset: VideoAsset) => void;
  /** asks before changing who can watch the video; leave out to offer no access change */
  access?: (asset: VideoAsset, tier: AccessTier) => void;
}

/**
 * The row menu of a video, the same in the table, the grid and the phone
 * cards: for a ready video Copy embed code leads, as the thing people come
 * to the list for, then Open video, Preview and the stream URL, the access
 * change, Copy video ID, and Delete set apart. A stream URL alone cannot
 * play a private video (it needs a signed URL from your server), so only
 * public videos offer it; "Copy embed code" copies the server signing code
 * for those.
 */
export function videoActions(asset: VideoAsset, on: VideoActionHandlers): RowAction[] {
  const ready = asset.status === 'ready';
  const isPublic = asset.accessTier === 'public';
  const actions: RowAction[] = [];
  if (ready) {
    actions.push({
      label: 'Copy embed code',
      icon: Icons.embed,
      onSelect: () => void copyWithToast(primaryEmbed(asset).code, 'Embed code copied'),
    });
  }
  actions.push({ label: 'Open video', icon: Icons.open, onSelect: () => on.open(asset) });
  if (ready) {
    actions.push({ label: 'Preview', icon: Icons.preview, onSelect: () => on.preview(asset) });
    if (isPublic) {
      actions.push({
        label: 'Copy stream URL',
        icon: Icons.link,
        onSelect: () =>
          void copyWithToast(streamUrl(window.location.origin, asset.id), 'Stream URL copied'),
      });
    }
  }
  const access = on.access;
  if (access) {
    actions.push(
      isPublic
        ? { label: 'Make private', icon: Lock, onSelect: () => access(asset, 'private') }
        : { label: 'Make public', icon: Globe, onSelect: () => access(asset, 'public') },
    );
  }
  actions.push(
    {
      label: 'Copy video ID',
      icon: Icons.copy,
      onSelect: () => void copyWithToast(asset.id, 'Video ID copied'),
    },
    {
      label: 'Delete…',
      icon: Icons.delete,
      destructive: true,
      onSelect: () => on.delete(asset),
    },
  );
  return actions;
}
