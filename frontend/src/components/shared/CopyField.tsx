import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { truncateMiddle } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { CopyButton } from './CopyButton';

export interface CopyFieldProps {
  value: string;
  /** names the value for the copy button and screen readers: "video ID", "stream URL" */
  label: string;
  /** a secret: shown as dots until revealed; the copy button copies it either way */
  secret?: boolean;
  /** shorten to this many characters on each side of an ellipsis, e.g. 8 for an id */
  truncate?: number;
  /** called after a copy, e.g. so a secret dialog knows the value was taken */
  onCopied?: () => void;
  className?: string;
}

/**
 * A value people copy: an id, a URL, a key. Mono text in a quiet box, the
 * full value in a tooltip when it is shortened, a copy button with Copied
 * feedback, and an eye toggle for secrets.
 *
 *   <CopyField label="video ID" value={asset.id} truncate={8} />
 *   <CopyField label="API key" value={secret} secret />
 */
export function CopyField({
  value,
  label,
  secret = false,
  truncate,
  onCopied,
  className,
}: CopyFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const hidden = secret && !revealed;
  const text = hidden
    ? '•'.repeat(Math.min(Math.max(value.length, 12), 32))
    : truncate
      ? truncateMiddle(value, truncate)
      : value;
  const shortened = !hidden && text !== value;

  return (
    <div
      data-slot="copy-field"
      className={cn(
        'flex h-8 min-w-0 items-center gap-1 rounded-md border bg-muted/40 pr-0.5 pl-2.5',
        className,
      )}
    >
      <span
        className={cn('min-w-0 flex-1 truncate font-mono text-xs', hidden && 'tracking-widest')}
        title={shortened ? value : undefined}
        aria-label={hidden ? `${label}, hidden` : undefined}
      >
        {text}
      </span>
      {secret && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          onClick={() => setRevealed((r) => !r)}
          aria-label={revealed ? `Hide ${label}` : `Show ${label}`}
          aria-pressed={revealed}
        >
          {revealed ? <EyeOff /> : <Eye />}
        </Button>
      )}
      <CopyButton value={value} label={`Copy ${label}`} onCopied={onCopied} />
    </div>
  );
}
