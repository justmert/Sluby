import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import type { VideoAsset } from '@sluby/sdk';
import { LazyAssetPlayer } from '@/components/asset/LazyAssetPlayer';
import { EmbedPanel } from '@/components/asset/EmbedPanel';
import { AccessBadge, StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useFrozen } from '@/hooks/useFrozen';
import { useMediaQuery } from '@/hooks/use-mobile';
import { ROUTES } from '@/lib/constants';
import { Icons } from '@/lib/icons';

export interface PreviewSheetProps {
  /** the video on show; the sheet is open while this is set */
  asset: VideoAsset | null;
  onClose: () => void;
  /** the ready videos before and after this one on the page, if any */
  previous: VideoAsset | null;
  next: VideoAsset | null;
  onStep: (to: VideoAsset) => void;
}

// arrow keys that a control inside the sheet uses itself: the video's own
// seeking, the quality toggle's roving focus, text fields
const OWNS_ARROWS =
  'video, input, textarea, select, [role="group"], [role="radiogroup"], [role="tablist"], [role="slider"]';

/**
 * A quick look at a ready video without leaving the library (RDS-03, D-04):
 * the player, then a link to the video page. Left and Right step through
 * the page's ready videos. Closing gives focus back to the video's title in
 * the list, so the keyboard user is where they started.
 */
export function PreviewSheet({ asset, onClose, previous, next, onStep }: PreviewSheetProps) {
  const open = asset !== null;
  // keeps the content while the sheet slides out
  const shown = useFrozen(asset, open);
  const phone = useMediaQuery('(max-width: 639px)');
  const [announce, setAnnounce] = useState('');

  const step = (to: VideoAsset | null) => {
    if (!to) return;
    onStep(to);
    setAnnounce(`Previewing “${to.title}”`);
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        side={phone ? 'bottom' : 'right'}
        className="gap-0 overflow-y-auto overscroll-contain data-[side=bottom]:max-h-[92dvh] data-[side=bottom]:rounded-t-xl data-[side=right]:w-full data-[side=right]:sm:max-w-2xl"
        onKeyDown={(e) => {
          if (e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey || e.shiftKey) return;
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          if ((e.target as HTMLElement).closest(OWNS_ARROWS)) return;
          e.preventDefault();
          step(e.key === 'ArrowLeft' ? previous : next);
        }}
        onCloseAutoFocus={(e) => {
          // the row's title link, found by id so it works for either view
          const link = shown
            ? document.querySelector<HTMLElement>(`[data-video-link="${CSS.escape(shown.id)}"]`)
            : null;
          if (link) {
            e.preventDefault();
            link.focus();
          }
        }}
      >
        {shown && (
          <>
            <SheetHeader className="gap-2 pr-12">
              <SheetTitle dir="auto" className="line-clamp-2 wrap-anywhere">
                {shown.title}
              </SheetTitle>
              <SheetDescription asChild>
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge kind="asset" status={shown.status} />
                  <AccessBadge access={shown.accessTier} />
                </div>
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-4 px-4 pb-4">
              {/* keyed, so stepping to another video starts a fresh player */}
              <LazyAssetPlayer
                key={shown.id}
                assetId={shown.id}
                signed={shown.accessTier === 'private'}
                title={shown.title}
              />
              <EmbedPanel asset={shown} compact />
            </div>
            <SheetFooter className="flex-row flex-wrap items-center justify-between gap-2 border-t">
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Previous video"
                  aria-keyshortcuts="ArrowLeft"
                  // aria-disabled, not disabled: a focused button that turns
                  // disabled drops focus out of the sheet at the last video
                  aria-disabled={!previous}
                  className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                  onClick={() => step(previous)}
                >
                  <ChevronLeft />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Next video"
                  aria-keyshortcuts="ArrowRight"
                  aria-disabled={!next}
                  className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
                  onClick={() => step(next)}
                >
                  <ChevronRight />
                </Button>
                <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:pointer-fine:flex">
                  {/* icons: the mono face has no arrow glyphs */}
                  <Kbd aria-hidden="true">
                    <ArrowLeft className="size-3" />
                  </Kbd>
                  <Kbd aria-hidden="true">
                    <ArrowRight className="size-3" />
                  </Kbd>
                  <span aria-hidden="true">to step through ready videos</span>
                </span>
              </div>
              <Button asChild>
                <Link to={ROUTES.video(shown.id)}>
                  <Icons.open />
                  Open video
                </Link>
              </Button>
            </SheetFooter>
            <p className="sr-only" role="status">
              {announce}
            </p>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
