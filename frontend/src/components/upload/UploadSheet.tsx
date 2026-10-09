import { lazy, Suspense } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { useMediaQuery } from '@/hooks/use-mobile';
import { useReturnFocus } from '@/hooks/useReturnFocus';
import { useUploadSheet } from '@/lib/upload-sheet';

const StudioUploadPanel = lazy(() => import('./StudioUploadPanel'));

/**
 * The upload sheet, open while the url has ?upload=1 (plan D-08): from the
 * right on wider screens, the full height from the bottom on phones. Drafts,
 * transfers and the queue live in the upload store, so closing the sheet
 * never loses them.
 */
export function UploadSheet() {
  const { isOpen, close } = useUploadSheet();
  const phone = useMediaQuery('(max-width: 639px)');
  // opened through the url, so radix has no trigger to give focus back to
  const focus = useReturnFocus();
  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && close()}>
      <SheetContent
        side={phone ? 'bottom' : 'right'}
        aria-describedby={undefined}
        onOpenAutoFocus={(e) => {
          focus.onOpenAutoFocus(e);
          // start on the sheet's first action rather than its close button
          const choose = (e.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>(
            '[data-upload-choose]',
          );
          if (choose) {
            e.preventDefault();
            choose.focus();
          }
        }}
        onCloseAutoFocus={focus.onCloseAutoFocus}
        className="gap-0 overflow-y-auto overscroll-contain data-[side=bottom]:h-dvh data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
      >
        <SheetHeader className="pr-12">
          <SheetTitle>Upload videos</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-8">
          <Suspense
            fallback={
              <div role="status" className="flex items-center gap-2 py-8 text-muted-foreground">
                <Spinner aria-hidden="true" />
                Loading…
              </div>
            }
          >
            <StudioUploadPanel />
          </Suspense>
        </div>
      </SheetContent>
    </Sheet>
  );
}
