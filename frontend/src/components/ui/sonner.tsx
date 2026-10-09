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
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <CircleAlertIcon className="size-4" />,
        loading: <Spinner aria-hidden="true" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': 'var(--radius-xl)',
          // rich colors from the tokens, so a toast's red and green are the
          // same as every badge and alert
          '--success-bg': 'color-mix(in oklab, var(--success) 10%, var(--popover))',
          '--success-border': 'color-mix(in oklab, var(--success) 30%, var(--popover))',
          '--success-text': 'var(--success)',
          '--error-bg': 'color-mix(in oklab, var(--destructive) 10%, var(--popover))',
          '--error-border': 'color-mix(in oklab, var(--destructive) 30%, var(--popover))',
          '--error-text': 'var(--destructive)',
          '--warning-bg': 'color-mix(in oklab, var(--warning) 15%, var(--popover))',
          '--warning-border': 'color-mix(in oklab, var(--warning) 40%, var(--popover))',
          '--warning-text': 'var(--warning-foreground)',
          '--info-bg': 'color-mix(in oklab, var(--info) 10%, var(--popover))',
          '--info-border': 'color-mix(in oklab, var(--info) 30%, var(--popover))',
          '--info-text': 'var(--info)',
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
          toast: 'cn-toast',
          // a finger needs more than the 20px close button
          closeButton: 'pointer-coarse:size-8',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
