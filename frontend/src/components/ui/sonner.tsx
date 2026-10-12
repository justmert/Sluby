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
          '--toast-close-button-transform': 'translateY(0.875rem)',
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
      // long enough to read a sentence; every toast also has a close button
      duration={8000}
      toastOptions={{
        classNames: {
          // room on the right for the close button
          toast: 'cn-toast pr-10! shadow-lg!',
          description: 'text-bar-muted!',
          // an outlined button on the bar, like Undo in the design
          actionButton:
            'border! border-bar-border! bg-transparent! font-semibold! text-bar-foreground! hover:bg-white/10!',
          cancelButton: 'border! border-bar-border! bg-transparent! text-bar-foreground!',
          // a finger needs more than the 20px close button
          closeButton:
            'border-0! bg-transparent! text-current opacity-60 hover:bg-transparent! hover:opacity-100 pointer-coarse:size-8',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
