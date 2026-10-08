import { useId, useState, type ReactNode } from 'react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { useFrozen } from '@/hooks/useFrozen';
import { InlineError } from './InlineError';

type ForItem<T, R> = R | ((item: T) => R);

export interface ConfirmDialogProps<T> {
  /**
   * What the dialog asks about: the dialog is open while this is set (not
   * null, undefined or false). It is frozen while the dialog animates closed,
   * so the text built from it does not go blank when the page clears it.
   */
  item: T | null | undefined | false;
  /** the dialog closed without confirming, or the action succeeded: clear `item` */
  onClose: () => void;
  /** a question, 40 characters at most: "Delete this video?" */
  title: ForItem<T, ReactNode>;
  /** the consequence first, then "This cannot be undone." Names go here, not in the title. */
  description: ForItem<T, ReactNode>;
  /** the verb on the confirm button: "Delete", "Revoke", "Sign out" */
  confirmLabel: string;
  /** the confirm button text while it runs, such as "Deleting…"; defaults to the label with "…" */
  pendingLabel?: string;
  /** the solid red confirm; set false for a confirmation that destroys nothing */
  destructive?: boolean;
  /**
   * For the most dangerous actions: the confirm stays disabled until this exact
   * text is typed, such as the video's title or "delete 12 videos".
   */
  typedConfirmation?: ForItem<T, string | undefined>;
  /**
   * Runs on confirm. If it returns a promise the dialog stays open with a busy
   * button until it settles: it closes on success and shows the error inside
   * on failure, so nothing closes before the answer is known.
   */
  onConfirm: (item: T) => unknown;
  /** the lead sentence of a failure: "Could not delete the video" */
  errorTitle?: string;
}

const resolve = <T, R>(value: ForItem<T, R>, item: T): R =>
  typeof value === 'function' ? (value as (item: T) => R)(item) : value;

/**
 * The one confirmation dialog for delete, revoke and sign out: a question, the
 * consequence, a solid red confirm that stays busy until the server answers,
 * the error inside if it fails, and an optional typed confirmation.
 *
 *   const [pending, setPending] = useState<VideoAsset | null>(null);
 *   <ConfirmDialog
 *     item={pending}
 *     onClose={() => setPending(null)}
 *     title="Delete this video?"
 *     description={(v) => <>“{v.title}” is removed from your library now and from Sia in the background. This cannot be undone.</>}
 *     confirmLabel="Delete"
 *     pendingLabel="Deleting…"
 *     errorTitle="Could not delete the video"
 *     onConfirm={(v) => remove.mutateAsync(v.id)}
 *   />
 */
export function ConfirmDialog<T>({
  item,
  onClose,
  title,
  description,
  confirmLabel,
  pendingLabel,
  destructive = true,
  typedConfirmation,
  onConfirm,
  errorTitle,
}: ConfirmDialogProps<T>) {
  const open = item !== null && item !== undefined && item !== false;
  const shown = useFrozen(item, open);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [typed, setTyped] = useState('');
  const [wasOpen, setWasOpen] = useState(open);
  const inputId = useId();

  // a fresh start each time it opens: no stale error or typed text
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setError(null);
      setTyped('');
      setPending(false);
    }
  }

  const has = shown !== null && shown !== undefined && shown !== false;
  const subject = shown as T;
  const phrase = has ? resolve(typedConfirmation, subject) : undefined;
  const matches = !phrase || typed.trim() === phrase;

  const confirm = async () => {
    if (pending || !matches || !open) return;
    setError(null);
    let result: unknown;
    try {
      result = onConfirm(item as T);
    } catch (err) {
      setError(err);
      return;
    }
    if (!(result instanceof Promise)) {
      onClose();
      return;
    }
    setPending(true);
    try {
      await result;
      setPending(false);
      onClose();
    } catch (err) {
      setPending(false);
      setError(err);
    }
  };

  return (
    <AlertDialog
      open={open}
      // nothing closes it while the answer is pending
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
    >
      <AlertDialogContent data-slot="confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>{has ? resolve(title, subject) : null}</AlertDialogTitle>
          <AlertDialogDescription>
            {has ? resolve(description, subject) : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {phrase && (
          <div className="grid gap-2">
            <Label htmlFor={inputId} className="block font-normal text-muted-foreground">
              Type <span className="font-mono font-medium text-foreground">{phrase}</span> to
              confirm.
            </Label>
            <Input
              id={inputId}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void confirm();
                }
              }}
              autoComplete="off"
              spellCheck={false}
              disabled={pending}
            />
          </div>
        )}
        <InlineError error={error} title={errorTitle ?? 'That did not work'} />
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={() => void confirm()}
            disabled={pending || !matches}
            aria-busy={pending || undefined}
          >
            {pending && <Spinner data-icon="inline-start" aria-hidden="true" />}
            {pending ? (pendingLabel ?? `${confirmLabel}…`) : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
