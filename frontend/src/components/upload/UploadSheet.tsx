import { lazy, Suspense } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { useMediaQuery } from '@/hooks/use-mobile';
import { useUploadSheet } from '@/lib/upload-sheet';

const UploadPanel = lazy(() => import('@/pages/studio/UploadPage'));

/**
 * The upload sheet, open while the url has ?upload=1 (plan D-08): from the
 * right on wider screens, the full height from the bottom on phones. The
 * transfers live in the upload store, so closing the sheet never stops them.
 */
export function UploadSheet() {
  const { isOpen, close } = useUploadSheet();
  const phone = useMediaQuery('(max-width: 639px)');
  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && close()}>
      <SheetContent
        side={phone ? 'bottom' : 'right'}
        aria-describedby={undefined}
        className="gap-0 overflow-y-auto overscroll-contain data-[side=bottom]:h-dvh data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
      >
        <SheetHeader className="pr-12">
          <SheetTitle>Upload videos</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-6">
          <Suspense
            fallback={
              <div role="status" className="flex items-center gap-2 py-8 text-muted-foreground">
                <Spinner aria-hidden="true" />
                Loading…
              </div>
            }
          >
            <UploadPanel embedded />
          </Suspense>
        </div>
      </SheetContent>
    </Sheet>
  );
}
