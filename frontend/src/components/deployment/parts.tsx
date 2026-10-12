// pieces the health and metrics cards share: the card frame with its heading
// row, the status dot and the toned chip
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { Tone } from './health';

/** An accent link or summary, darker on hover like the design's accent-hover. */
export const ACCENT_LINK =
  'rounded-sm font-semibold text-primary transition-colors duration-150 ease-(--ease-design) hover:text-[color-mix(in_oklab,var(--primary),var(--foreground)_20%)]';

const DOT: Record<Tone, string> = {
  ok: 'bg-success',
  warn: 'bg-warning-foreground',
  bad: 'bg-destructive',
  neutral: 'bg-muted-foreground',
};

/** An 8px status dot; the words next to it carry the meaning. */
export function Dot({ tone, className }: { tone: Tone; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-tone={tone}
      className={cn('size-2 shrink-0 rounded-full', DOT[tone], className)}
    />
  );
}

const CHIP = {
  ok: 'success',
  warn: 'warning',
  bad: 'destructive',
  neutral: 'secondary',
} as const satisfies Record<Tone, string>;

/** A status chip: neutral fill, the tone in its edge and text. */
export function ToneChip({
  tone,
  dot = false,
  className,
  children,
}: {
  tone: Tone;
  /** a dot before the words, for the page's overall verdict */
  dot?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Badge
      variant={CHIP[tone]}
      data-tone={tone}
      className={cn('h-5.5 gap-1.5 font-semibold', className)}
    >
      {dot && <Dot tone={tone} />}
      {children}
    </Badge>
  );
}

/**
 * A card with a heading row: the title, an optional muted note beside it and
 * an action at the end. The heading names the section for screen readers.
 */
export function Panel({
  id,
  title,
  note,
  action,
  className,
  children,
}: {
  id: string;
  title: string;
  note?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      data-slot="card"
      className={cn(
        'flex min-w-0 flex-col gap-3.5 rounded-xl border bg-card px-6 py-5 text-sm text-card-foreground',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <h2 id={id} className="font-heading text-heading">
          {title}
        </h2>
        {note}
        {action && <div className="ml-auto flex shrink-0 items-center gap-3">{action}</div>}
      </div>
      {children}
    </section>
  );
}
