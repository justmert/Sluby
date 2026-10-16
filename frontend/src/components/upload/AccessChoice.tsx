import { useId } from 'react';
import type { AccessTier } from '@sluby/sdk';
import { cn } from '@/lib/utils';

const OPTIONS = [
  {
    value: 'public',
    label: 'Public',
    description: 'Anyone with the link or embed',
  },
  {
    value: 'private',
    label: 'Private',
    description: 'Only with signed links',
  },
] as const satisfies ReadonlyArray<{
  value: AccessTier;
  label: string;
  description: string;
}>;

/**
 * Who can watch, as two radio cards that state the consequence at the moment
 * of choosing (copy.md P6). Native radios in a fieldset, so arrow keys move
 * between them and each card's sentence is its description (A11Y-36).
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
    <fieldset
      role="radiogroup"
      aria-labelledby={`${id}-legend`}
      aria-describedby={hint ? `${id}-hint` : undefined}
      className="m-0 grid min-w-0 grid-cols-[repeat(auto-fit,minmax(12.5rem,1fr))] gap-2.5 border-0 p-0"
    >
      <legend id={`${id}-legend`} className="mb-1.5 text-sm font-semibold">
        Who can watch
      </legend>
      {OPTIONS.map((o) => {
        const checked = value === o.value;
        return (
          // the checked card draws a 2px edge and gives back 1px of padding,
          // so choosing one does not nudge the text
          <label
            key={o.value}
            className={cn(
              'flex cursor-pointer gap-2.5 rounded-lg border text-sm transition-colors duration-150 ease-design',
              checked
                ? 'border-2 border-primary p-[11px]'
                : 'border-border-strong p-3 hover:bg-background',
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
              className="mt-0.5 size-4 shrink-0"
            />
            <span className="min-w-0">
              <span id={`${id}-${o.value}-label`} className="block font-semibold">
                {o.label}
              </span>
              <span id={`${id}-${o.value}`} className="text-muted-foreground">
                {o.description}
              </span>
            </span>
          </label>
        );
      })}
      {hint && (
        <p id={`${id}-hint`} className="col-span-full text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </fieldset>
  );
}
