import { CopyButton } from './CopyButton';
import { cn } from '@/lib/utils';

export function CodeBlock({
  code,
  label,
  className,
}: {
  code: string;
  /** Names the snippet for the copy button. */
  label: string;
  className?: string;
}) {
  return (
    <div className={cn('relative rounded-lg border bg-muted/40', className)}>
      <CopyButton value={code} label={`Copy ${label}`} className="absolute top-2 right-2" />
      {/* chrome lets a keyboard scroll a wide snippet, so it takes focus */}
      <pre className="overflow-x-auto rounded-lg p-4 pr-12 font-mono text-xs leading-relaxed outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <code>{code}</code>
      </pre>
    </div>
  );
}
