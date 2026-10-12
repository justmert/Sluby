import { useId } from 'react';
import { Globe, Lock } from 'lucide-react';
import type { AccessTier } from '@sluby/sdk';
import { cn } from '@/lib/utils';

const OPTIONS = [
  {
    value: 'public',
    label: 'Public',
    icon: Globe,
    description: 'Anyone with the link can play it.',
  },
  {
    value: 'private',
    label: 'Private',
    icon: Lock,
    description: 'Plays only through signed URLs your server creates.',
  },
] as const satisfies ReadonlyArray<{
  value: AccessTier;
  label: string;
  description: string;
  icon: unknown;
}>;

/**
 * Who can watch, as two radio cards that state the consequence at the moment
 * of choosing (copy.md P6). Native radios, so arrow keys move between them and
 * each card's sentence is its description (A11Y-36).
 */
export function AccessChoice({
  value,
  onChange,
  hint,
}: {
  value: AccessTier;
  onChange: (value: AccessTier) => void;
  /** a line under the cards, such as "This applies to every video in the list." */
  hint?: string;
}) {
  const id = useId();
  return (
    <div
      role="radiogroup"
      aria-labelledby={`${id}-legend`}
      aria-describedby={hint ? `${id}-hint` : undefined}
      className="flex flex-col gap-2"
    >
      <p id={`${id}-legend`} className="text-sm leading-5 font-medium">
        Who can watch
      </p>
      <div className="grid gap-2 @md/upload:grid-cols-2">
        {OPTIONS.map((o) => {
          const checked = value === o.value;
          return (
            <label
              key={o.value}
              className={cn(
                'relative flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors duration-150 has-focus-visible:ring-3 has-focus-visible:ring-ring',
                checked ? 'border-primary ring-1 ring-primary' : 'hover:border-border-strong',
              )}
            >
              <input
                type="radio"
                name={`${id}-access`}
                value={o.value}
                checked={checked}
                onChange={() => onChange(o.value)}
                aria-labelledby={`${id}-${o.value}-label`}
                aria-describedby={`${id}-${o.value}`}
                className="peer sr-only"
              />
              <span
                aria-hidden="true"
                className={cn(
                  'mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border',
                  checked ? 'border-primary' : 'border-input',
                )}
              >
                {checked && <span className="size-2 rounded-full bg-primary" />}
              </span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span
                  id={`${id}-${o.value}-label`}
                  className="flex items-center gap-1.5 text-sm font-medium"
                >
                  <o.icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  {o.label}
                </span>
                <span id={`${id}-${o.value}`} className="text-xs text-muted-foreground">
                  {o.description}
                </span>
              </span>
            </label>
          );
        })}
      </div>
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}
