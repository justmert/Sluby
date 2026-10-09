import { Checkbox } from '@/components/ui/checkbox';
import { FieldError, FieldLegend, FieldSet } from '@/components/ui/field';
import { Label } from '@/components/ui/label';

export interface Option {
  /** the api value, shown in mono: "upload", "asset.ready" */
  value: string;
  /** what it means, on its own line */
  detail: string;
}

/**
 * Checkboxes for scopes or events: the api name on one line and what it
 * means under it, so long descriptions wrap with room to read (VIS-05).
 */
export function OptionList({
  legend,
  options,
  value,
  onChange,
  idPrefix,
  error,
  disabled,
}: {
  legend: string;
  options: Option[];
  value: string[];
  onChange: (next: string[]) => void;
  /** checkbox ids are `{idPrefix}-{value}`, so a form can focus the first one */
  idPrefix: string;
  error?: string | null;
  disabled?: boolean;
}) {
  const errorId = `${idPrefix}-error`;
  return (
    <FieldSet
      data-invalid={!!error || undefined}
      aria-describedby={error ? errorId : undefined}
      className="gap-3"
    >
      <FieldLegend variant="label">{legend}</FieldLegend>
      <div className="flex flex-col gap-3">
        {options.map((o) => {
          const id = `${idPrefix}-${o.value}`;
          return (
            <div key={o.value} className="flex items-start gap-3">
              <Checkbox
                id={id}
                className="mt-0.5"
                checked={value.includes(o.value)}
                disabled={disabled}
                aria-describedby={`${id}-detail`}
                onCheckedChange={(on) =>
                  onChange(
                    on === true
                      ? [...value.filter((v) => v !== o.value), o.value]
                      : value.filter((v) => v !== o.value),
                  )
                }
              />
              <div className="grid min-w-0 gap-0.5">
                <Label htmlFor={id} className="font-mono text-sm font-normal">
                  {o.value}
                </Label>
                <p id={`${id}-detail`} className="text-xs text-muted-foreground">
                  {o.detail}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      <FieldError id={errorId}>{error}</FieldError>
    </FieldSet>
  );
}
