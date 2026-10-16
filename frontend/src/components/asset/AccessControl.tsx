import { useId, useRef, useState } from 'react';
import type { AccessTier } from '@sluby/sdk';
import { Button } from '@/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { errorText } from '@/lib/errors';

const CONFIRM: Record<AccessTier, { title: string; body: string; action: string }> = {
  private: {
    title: 'Make this video private?',
    body: 'Players without a signed URL stop working within a minute. Viewers who already have a link keep it until it expires.',
    action: 'Make private',
  },
  public: {
    title: 'Make this video public?',
    body: 'Anyone with the stream URL can play it.',
    action: 'Make public',
  },
};

export interface AccessControlProps {
  value: AccessTier;
  /** Saves the new access; a rejection keeps the confirm open with the reason. */
  onChange: (next: AccessTier) => Promise<unknown>;
  disabled?: boolean;
  className?: string;
}

/**
 * Public | Private for one video. Either way asks first in a small popover,
 * since it changes who can play the video right away (D-12). Focus stays in
 * the popover while it is open and goes back to the control after.
 */
export function AccessControl({
  value,
  onChange,
  disabled = false,
  className,
}: AccessControlProps) {
  const [pending, setPending] = useState<AccessTier | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // the copy stays on the last choice while the popover closes
  const [shown, setShown] = useState<AccessTier>('private');
  const group = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const bodyId = useId();

  const close = () => {
    if (saving) return;
    setPending(null);
    setError(null);
  };

  const confirm = async () => {
    if (!pending) return;
    setSaving(true);
    setError(null);
    try {
      await onChange(pending);
      setPending(null);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setSaving(false);
    }
  };

  const copy = CONFIRM[pending ?? shown];

  return (
    <Popover modal open={pending !== null} onOpenChange={(open) => !open && close()}>
      <PopoverAnchor asChild>
        <ToggleGroup
          ref={group}
          type="single"
          variant="segmented"
          value={value}
          disabled={disabled}
          aria-label="Who can watch"
          className={className}
          onValueChange={(next) => {
            // radix sends "" when the pressed item is pressed again
            if (!next || next === value) return;
            setShown(next as AccessTier);
            setPending(next as AccessTier);
          }}
        >
          <ToggleGroupItem value="public">Public</ToggleGroupItem>
          <ToggleGroupItem value="private">Private</ToggleGroupItem>
        </ToggleGroup>
      </PopoverAnchor>
      <PopoverContent
        align="end"
        role="dialog"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        className="w-80"
        onCloseAutoFocus={(e) => {
          // back to the control, on the option that is now selected
          e.preventDefault();
          group.current?.querySelector<HTMLElement>('[data-state=on]')?.focus();
        }}
      >
        <p id={titleId} className="font-heading text-heading">
          {copy.title}
        </p>
        <p id={bodyId} className="mt-1 text-sm text-muted-foreground">
          {copy.body}
        </p>
        {error && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => void confirm()}
            disabled={saving}
            aria-busy={saving || undefined}
          >
            {saving && <Spinner aria-hidden="true" role={undefined} aria-label={undefined} />}
            {copy.action}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
