'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { PortalContainerProvider } from '@/components/ui/portal-container';
import { Dialog as DialogPrimitive } from 'radix-ui';

import { Button } from '@/components/ui/button';
import { useReturnFocus } from '@/hooks/useReturnFocus';
import { XIcon } from 'lucide-react';

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        // the design's scrim: warm black at 45%, fading with the dialog
        'fixed inset-0 isolate z-50 bg-[rgb(12_10_9/0.45)] duration-240 ease-design data-closed:duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
        className,
      )}
      {...props}
    />
  );
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
}) {
  const focus = useReturnFocus(onOpenAutoFocus, onCloseAutoFocus);
  // what opens inside goes to body after this dialog, not into the page behind it
  return (
    <PortalContainerProvider container={null}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          data-slot="dialog-content"
          className={cn(
            // centred as in the design by auto margins rather than a translate,
            // so the entrance (rise 6px and fade over 240 ms) owns translate.
            // the height cap keeps long forms scrollable
            'fixed inset-0 z-50 m-auto grid h-fit max-h-[calc(100dvh-2.5rem)] w-[calc(100%-2rem)] gap-3.5 overflow-y-auto rounded-2xl border bg-popover px-6 py-5.5 text-sm text-popover-foreground shadow-dialog outline-none sm:max-w-115 data-open:animate-enter data-closed:animate-out data-closed:fade-out-0 data-closed:duration-150',
            className,
          )}
          {...focus}
          {...props}
        >
          {children}
          {showCloseButton && (
            <DialogPrimitive.Close data-slot="dialog-close" asChild>
              <Button variant="ghost" className="absolute top-3 right-3" size="icon-sm">
                <XIcon />
                <span className="sr-only">Close</span>
              </Button>
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </PortalContainerProvider>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-2.5 pr-8', className)}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        // the buttons sit at the end of the dialog with no bar of their own. it
        // sticks to the bottom of a dialog that scrolls, on the dialog's own
        // surface, so Save stays reachable; not on very short screens (400%
        // zoom), where it would cover the field in focus
        '-bottom-5.5 -mx-6 -mb-5.5 flex [@media(min-height:30rem)]:sticky flex-col-reverse gap-2 rounded-b-2xl bg-popover px-6 pt-1 pb-5.5 sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('font-heading text-lg leading-7 font-bold', className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        'text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground',
        className,
      )}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
