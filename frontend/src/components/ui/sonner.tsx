import { useTheme } from '@/lib/theme';
import { Toaster as Sonner, type ToasterProps } from 'sonner';
import { CircleAlertIcon, CircleCheckIcon, InfoIcon, TriangleAlertIcon } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';

const Toaster = ({ ...props }: ToasterProps) => {
  const { resolvedTheme } = useTheme();

  return (
    <Sonner
      theme={resolvedTheme}
      className="toaster group"
      // the icon carries the kind; the bar itself is the same for all of them
      icons={{
        success: <CircleCheckIcon className="size-4 text-bar-success" />,
        info: <InfoIcon className="size-4 text-bar-muted" />,
        warning: <TriangleAlertIcon className="size-4 text-bar-warning" />,
        error: <CircleAlertIcon className="size-4 text-bar-destructive" />,
        loading: <Spinner aria-hidden="true" />,
      }}
      style={
        {
          // every toast is the dark bar from the design, in both themes (see
          // --bar in index.css); rich colors would tint it, so each kind
          // gets the same bar and its color stays on the icon
          '--normal-bg': 'var(--bar)',
          '--normal-text': 'var(--bar-foreground)',
          '--normal-border': 'var(--bar)',
          '--border-radius': 'var(--radius-lg)',
          '--success-bg': 'var(--bar)',
          '--success-border': 'var(--bar)',
          '--success-text': 'var(--bar-foreground)',
          '--error-bg': 'var(--bar)',
          '--error-border': 'var(--bar)',
          '--error-text': 'var(--bar-foreground)',
          '--warning-bg': 'var(--bar)',
          '--warning-border': 'var(--bar)',
          '--warning-text': 'var(--bar-foreground)',
          '--info-bg': 'var(--bar)',
          '--info-border': 'var(--bar)',
          '--info-text': 'var(--bar-foreground)',
          // the close button sits inside the toast, top right, instead of as
          // a bordered circle straddling its corner
          '--toast-close-button-start': 'unset',
          '--toast-close-button-end': '0.5rem',
          '--toast-close-button-transform': 'translateY(0.5625rem)',
        } as React.CSSProperties
      }
      // bottom right on a desktop; below 600px sonner spans the width, so on
      // phones they sit bottom center. --toast-lift raises them over a bar
      // pinned to the bottom of the page (the videos bulk bar sets it), so a
      // toast never covers its buttons (D-20)
      position="bottom-right"
      offset={{
        top: '24px',
        right: '24px',
        bottom: 'calc(24px + var(--toast-lift, 0px))',
        left: '24px',
      }}
      // sonner's mobile default is 16px from each edge; keep that clear of
      // notches and the home indicator too
      mobileOffset={{
        top: 'calc(16px + env(safe-area-inset-top))',
        right: 'calc(16px + env(safe-area-inset-right))',
        bottom: 'calc(16px + env(safe-area-inset-bottom) + var(--toast-lift, 0px))',
        left: 'calc(16px + env(safe-area-inset-left))',
      }}
      // the design's timing: 5 s each, paused while the pointer is on them
      // (sonner pauses on hover and focus). errors stay until closed, see
      // lib/toast.ts
      duration={5000}
      // stacked open, newest on top, 10 px apart, as in the design, rather
      // than folded behind each other
      expand
      gap={10}
      toastOptions={{
        classNames: {
          // the design's bar: 10 px corners, 12 by 14 padding, 10 px between
          // icon, words and buttons; room on the right for the close button
          toast:
            'cn-toast gap-2.5! rounded-lg! py-3! pr-11! pl-3.5! text-sm! font-normal! shadow-toast!',
          description: 'text-bar-muted!',
          // an outlined button on the bar, like Undo in the design
          actionButton:
            'h-7! rounded-[6px]! border! border-bar-border! bg-transparent! px-2.5! text-[13px]! font-semibold! text-bar-foreground! hover:bg-white/10!',
          cancelButton:
            'h-7! rounded-[6px]! border! border-bar-border! bg-transparent! px-2.5! text-[13px]! text-bar-foreground!',
          // a finger needs more than the 20px close button
          closeButton:
            'size-7! border-0! bg-transparent! text-current opacity-70 hover:bg-transparent! hover:opacity-100 pointer-coarse:size-9!',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
