import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { errorText } from '@/lib/errors';
import { formatCount } from '@/lib/formatters';
import { lateReveal } from '@/lib/motion';
import { cn } from '@/lib/utils';

export interface InlineEditFieldProps {
  value: string;
  /** saves the new value; a returned promise keeps the field busy until it settles */
  onSave: (next: string) => unknown;
  /** what the value is, for the edit button and the input: "title", "description" */
  label: string;
  /** a textarea; Enter adds a line and ⌘/Ctrl+Enter saves */
  multiline?: boolean;
  placeholder?: string;
  maxLength?: number;
  /** an empty value is refused with this message ("Enter a title."); leave out to allow empty */
  requiredMessage?: string;
  /** how the value reads when not editing, e.g. the page title's classes */
  displayClassName?: string;
  /** shown when the value is empty and not editing */
  emptyText?: ReactNode;
  disabled?: boolean;
  className?: string;
  /** called when editing starts, e.g. to note the version the edit is based on */
  onEditStart?: () => void;
  /**
   * Render the value yourself (inside an h1, say) and get a separate pencil
   * button named "Edit {label}" beside it. The value then keeps its own
   * accessible name, which the default (the value is the button) replaces.
   */
  display?: (shown: string) => ReactNode;
  /** what to show under the field when a save fails; the reader's sentence from errorText by default */
  renderError?: (err: unknown) => ReactNode;
  /** show "{n} of {maxLength}" under the field once the text reaches this length */
  counterFrom?: number;
}

/**
 * Edit a value where it is shown: click (or Enter on the focused value) to
 * edit, Enter or leaving the field saves, Escape cancels. While saving, the
 * new text shows with a spinner; a failure brings the field back with the
 * error under it and the text kept, so nothing typed is lost.
 *
 *   <InlineEditField label="title" value={asset.title} requiredMessage="Enter a title."
 *     maxLength={200} displayClassName="font-heading text-title"
 *     onSave={(title) => update.mutateAsync({ title })} />
 */
export function InlineEditField({
  value,
  onSave,
  label,
  multiline = false,
  placeholder,
  maxLength,
  requiredMessage,
  displayClassName,
  emptyText,
  disabled = false,
  className,
  onEditStart,
  display,
  renderError,
  counterFrom,
}: InlineEditFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<ReactNode>(null);
  // the value just saved, shown until the new value comes back as a prop
  const [saved, setSaved] = useState<string | null>(null);
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setSaved(null);
  }
  const errorId = useId();
  // set while the escape key cancels, so the blur that follows does not save
  const cancelled = useRef(false);
  // after Enter or Escape, focus goes back to the control that opened the field
  const trigger = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  useEffect(() => {
    // with `display` the button only comes back once the save has settled
    if (!editing && refocus.current && trigger.current) {
      refocus.current = false;
      trigger.current.focus();
    }
  }, [editing, saving]);

  const start = () => {
    if (disabled || saving !== null) return;
    cancelled.current = false;
    setDraft(saved ?? value);
    setError(null);
    setEditing(true);
    onEditStart?.();
  };

  const cancel = () => {
    cancelled.current = true;
    refocus.current = true;
    setEditing(false);
    setError(null);
  };

  const commit = async () => {
    if (cancelled.current) return;
    const next = multiline ? draft.replace(/\s+$/, '') : draft.trim();
    if (next === (saved ?? value)) {
      setEditing(false);
      setError(null);
      return;
    }
    if (next === '' && requiredMessage) {
      setError(requiredMessage);
      return;
    }
    setEditing(false);
    setSaving(next);
    setError(null);
    try {
      await onSave(next);
      setSaved(next);
      setSaving(null);
    } catch (err) {
      setSaving(null);
      setDraft(next);
      setError(renderError ? renderError(err) : errorText(err));
      setEditing(true);
    }
  };

  if (editing) {
    const shared = {
      'aria-label': `Edit ${label}`,
      'aria-invalid': error ? true : undefined,
      'aria-describedby': error ? errorId : undefined,
      value: draft,
      placeholder,
      maxLength,
      autoFocus: true,
      onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        e.currentTarget.select(),
      onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        // focus moving to something inside the field, like a Reload button in
        // its error, is not leaving it
        if (e.relatedTarget && e.currentTarget.parentElement?.contains(e.relatedTarget)) return;
        void commit();
      },
    };
    return (
      <div data-slot="inline-edit" className={cn('min-w-0', className)}>
        {multiline ? (
          <Textarea
            {...shared}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') cancel();
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                refocus.current = true;
                void commit();
              }
            }}
          />
        ) : (
          <Input
            {...shared}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') cancel();
              if (e.key === 'Enter') {
                e.preventDefault();
                refocus.current = true;
                void commit();
              }
            }}
          />
        )}
        {counterFrom !== undefined && maxLength !== undefined && draft.length >= counterFrom && (
          <p
            className="mt-1 text-right text-xs text-muted-foreground tabular-nums"
            aria-live="polite"
          >
            {formatCount(draft.length)} of {formatCount(maxLength)}
          </p>
        )}
        {error && (
          <div id={errorId} role="alert" className="mt-1.5 text-sm text-destructive">
            {error}
          </div>
        )}
      </div>
    );
  }

  const shown = saving ?? saved ?? value;
  const busy =
    saving !== null ? (
      // shows only when the save takes a moment, so a quick one does not flash it
      <Spinner
        className={cn('size-3.5 shrink-0 text-muted-foreground', lateReveal)}
        aria-label={`Saving ${label}`}
      />
    ) : null;

  if (display) {
    return (
      <div
        data-slot="inline-edit"
        aria-busy={saving !== null || undefined}
        className={cn('flex max-w-full min-w-0 items-start gap-1', className)}
      >
        <div className="min-w-0">{display(shown)}</div>
        {busy ? (
          <span className="flex size-8 shrink-0 items-center justify-center">{busy}</span>
        ) : (
          <Button
            ref={trigger}
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={start}
            disabled={disabled}
            aria-label={`Edit ${label}`}
            className="shrink-0 text-muted-foreground"
          >
            <Pencil aria-hidden="true" />
          </Button>
        )}
      </div>
    );
  }

  return (
    <button
      ref={trigger}
      type="button"
      data-slot="inline-edit"
      onClick={start}
      disabled={disabled}
      aria-label={`Edit ${label}`}
      aria-busy={saving !== null || undefined}
      className={cn(
        'group/inline-edit -mx-1.5 flex max-w-full min-w-0 items-center gap-2 rounded-md px-1.5 text-left transition-colors duration-150 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none',
        className,
      )}
    >
      <span
        dir="auto"
        className={cn(
          'min-w-0',
          multiline ? 'whitespace-pre-wrap wrap-anywhere' : 'truncate',
          !shown && 'text-muted-foreground',
          displayClassName,
        )}
      >
        {shown || emptyText || placeholder || `Add ${label}`}
      </span>
      {busy ?? (
        <Pencil
          aria-hidden="true"
          className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity duration-150 group-hover/inline-edit:opacity-100 group-focus-visible/inline-edit:opacity-100 pointer-coarse:opacity-100"
        />
      )}
    </button>
  );
}
