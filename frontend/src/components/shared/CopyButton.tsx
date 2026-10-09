import { useEffect, useRef, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { Check, Copy, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { scaleIn } from '@/lib/motion';
import { cn } from '@/lib/utils';

export interface CopyButtonProps {
  value: string;
  className?: string;
  label?: string;
  /** Show "Copy" next to the icon, for places where copying is the main action. */
  withText?: boolean;
  variant?: 'ghost' | 'outline' | 'default';
  /** called once the value is on the clipboard, e.g. to let a secret dialog close */
  onCopied?: () => void;
}

type CopyState = 'idle' | 'copied' | 'failed';

const ICONS = { idle: Copy, copied: Check, failed: X } as const;
const TEXT = { idle: 'Copy', copied: 'Copied', failed: 'Copy failed' } as const;

export function CopyButton({
  value,
  className,
  label = 'Copy to clipboard',
  withText = false,
  variant = 'ghost',
  onCopied,
}: CopyButtonProps) {
  const [state, setState] = useState<CopyState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setState('copied');
      onCopied?.();
    } catch {
      // clipboard needs a secure context; say so instead of pretending
      setState('failed');
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState('idle'), 2000);
  };

  const Icon = ICONS[state];

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={withText ? 'sm' : 'icon-sm'}
        className={cn(!withText && 'text-muted-foreground', className)}
        onClick={copy}
        aria-label={label}
        title={state === 'failed' ? 'Copy failed: clipboard unavailable' : label}
        data-state={state}
      >
        {/* both icons share one cell while they swap, so the button keeps its size */}
        <span className="inline-grid size-4 place-items-center *:col-start-1 *:row-start-1 [&_svg]:size-full">
          <AnimatePresence initial={false}>
            <m.span
              key={state}
              variants={scaleIn}
              initial="hidden"
              animate="visible"
              exit="exit"
              className={cn(
                'flex size-3.5',
                state === 'copied' && 'text-success',
                state === 'failed' && 'text-destructive',
              )}
            >
              <Icon aria-hidden="true" />
            </m.span>
          </AnimatePresence>
        </span>
        {withText && (
          <span aria-hidden="true" className="tabular-nums">
            {TEXT[state]}
          </span>
        )}
      </Button>
      {/* a changed label on a focused button is not announced; a live region is */}
      <span className="sr-only" role="status" aria-live="polite">
        {state === 'copied'
          ? 'Copied'
          : state === 'failed'
            ? 'Copy failed: clipboard unavailable'
            : ''}
      </span>
    </>
  );
}
