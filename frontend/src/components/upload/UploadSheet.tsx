import { useEffect } from 'react';
import { InlineError } from '@/components/shared/InlineError';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useMediaQuery } from '@/hooks/use-mobile';
import { useReturnFocus } from '@/hooks/useReturnFocus';
import { useUploadSheet } from '@/lib/upload-sheet';
import { loadUploadPanel, useUploadPanel } from './panel-loader';

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
  const panel = useUploadPanel();
  useEffect(() => loadUploadPanel(), []);
  // the sheet waits for its panel, so it never shows a title that is not
  // there yet; a panel that could not load still opens, with the reason
  const shown = isOpen && (panel.status === 'ready' || panel.status === 'failed');
  return (
    <Sheet open={shown} onOpenChange={(open) => !open && close()}>
      <SheetContent
        side={phone ? 'bottom' : 'right'}
        aria-describedby={undefined}
        onOpenAutoFocus={(e) => {
          focus.onOpenAutoFocus(e);
          // a title the panel just focused keeps it; otherwise start on "choose files"
          e.preventDefault();
          const sheet = e.currentTarget as HTMLElement | null;
          const choose = sheet?.querySelector<HTMLElement>('[data-upload-choose]');
          if (choose && !sheet?.contains(document.activeElement)) choose.focus();
          else if (!sheet?.contains(document.activeElement)) sheet?.focus();
        }}
        onCloseAutoFocus={focus.onCloseAutoFocus}
        className="gap-0 overflow-y-auto overscroll-contain outline-none data-[side=bottom]:h-dvh data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
      >
        <SheetHeader className="pr-12">
          <SheetTitle>Upload videos</SheetTitle>
        </SheetHeader>
        <div className="px-4 pb-8">
          {panel.status === 'ready' ? (
            <panel.Panel />
          ) : panel.status === 'failed' ? (
            <InlineError
              title="Could not load the upload sheet"
              error={panel.error}
              onRetry={loadUploadPanel}
            />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
