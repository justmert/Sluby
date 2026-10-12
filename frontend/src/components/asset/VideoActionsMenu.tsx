import { ChevronDown, Fingerprint, Link2 } from 'lucide-react';
import type { VideoAsset } from '@sluby/sdk';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { streamUrl } from '@/lib/embed';
import { Icons } from '@/lib/icons';
import { toastError, toastSuccess } from '@/lib/toast';

async function copy(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    toastSuccess(done);
  } catch {
    toastError('Could not copy. Your browser blocked the clipboard');
  }
}

export interface VideoActionsMenuProps {
  asset: Pick<VideoAsset, 'id' | 'status'>;
  /** Opens the page's delete confirmation. */
  onDelete: () => void;
  deleting?: boolean;
}

/**
 * The video page's More menu beside Copy embed code: the copy actions, then
 * Delete set apart in red. The Delete video card says the same at the foot
 * of the side column (D-22).
 */
export function VideoActionsMenu({ asset, onDelete, deleting = false }: VideoActionsMenuProps) {
  return (
    // not modal: a modal menu hides the page from screen readers while it
    // stays focusable behind the menu (axe aria-hidden-focus)
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" aria-label="More actions">
          More
          <ChevronDown data-icon="inline-end" className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-48">
        <DropdownMenuItem onSelect={() => void copy(asset.id, 'Video ID copied')}>
          <Fingerprint aria-hidden="true" />
          Copy video ID
        </DropdownMenuItem>
        {asset.status === 'ready' && (
          <DropdownMenuItem
            onSelect={() =>
              void copy(streamUrl(window.location.origin, asset.id), 'Stream URL copied')
            }
          >
            <Link2 aria-hidden="true" />
            Copy stream URL
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onDelete} disabled={deleting}>
          <Icons.delete aria-hidden="true" />
          Delete video
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
