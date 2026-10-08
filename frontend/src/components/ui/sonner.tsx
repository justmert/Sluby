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
      // sonner's mobile default is 16px from each edge; keep that clear of
      // notches and the home indicator too
      mobileOffset={{
        top: 'calc(16px + env(safe-area-inset-top))',
        right: 'calc(16px + env(safe-area-inset-right))',
        bottom: 'calc(16px + env(safe-area-inset-bottom))',
        left: 'calc(16px + env(safe-area-inset-left))',
      }}
      toastOptions={{
        classNames: {
          toast: 'cn-toast',
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
