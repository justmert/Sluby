import { useState } from 'react';
import { InlineError } from '@/components/shared/InlineError';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { useFrozen } from '@/hooks/useFrozen';
import { useRotateApiKey, type ApiKeyRecord, type IssuedKey } from '@/hooks/useApiKeys';
import { statusOf } from '@/lib/api-client';
import { toastError } from '@/lib/toast';
import { keyLabel } from './key-label';
import { DEFAULT_GRACE, GRACE_OPTIONS } from './options';

// the waits first, shortest to longest, and stopping at once last, so the
// safe choices come before the one that cuts servers off
const PILLS = [...GRACE_OPTIONS].sort((a, b) =>
  a.value === '0' ? 1 : b.value === '0' ? -1 : Number(a.value) - Number(b.value),
);

/**
 * Issue a new secret for a key, keeping the old one working for a while if
 * servers still use it. A key that is gone or already rotated closes the
 * dialog with a toast, since the list behind it was out of date; any other
 * failure stays in the dialog.
 */
export function RotateKeyDialog({
  target,
  onClose,
  onIssued,
  onCloseAutoFocus,
}: {
  target: ApiKeyRecord | null;
  onClose: () => void;
  onIssued: (issued: IssuedKey, graceSeconds: number) => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const rotate = useRotateApiKey();
  const open = target !== null;
  const shown = useFrozen(target, open);
  const [grace, setGrace] = useState(DEFAULT_GRACE);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setGrace(DEFAULT_GRACE);
  }

  const close = () => {
    if (rotate.isPending) return;
    rotate.reset();
    onClose();
  };

  const confirm = async () => {
    if (!target || rotate.isPending) return;
    const graceSeconds = Number(grace);
    try {
      const issued = await rotate.mutateAsync({ id: target.id, graceSeconds });
      rotate.reset();
      onClose();
      onIssued(issued, graceSeconds);
    } catch (err) {
      const status = statusOf(err);
      // the list was stale and the mutation refreshed it; nothing to fix here
      if (status === 404) {
        rotate.reset();
        onClose();
        toastError(`“${target.name}” no longer exists. The list is up to date now`);
      } else if (status === 409) {
        rotate.reset();
        onClose();
        toastError(`“${target.name}” was already rotated. Rotate its replacement`);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>Rotate this key?</DialogTitle>
          <DialogDescription>
            {shown && <>{keyLabel(shown)} gets a new key with the same scopes and limit. </>}
            Keep the old one working while you update your servers.
          </DialogDescription>
        </DialogHeader>
        <fieldset className="flex min-w-0 flex-col gap-2" disabled={rotate.isPending}>
          <legend className="mb-2 text-sm font-medium">Old key keeps working for</legend>
          <div className="flex flex-wrap gap-2">
            {PILLS.map((o) => (
              // the selected pill draws a 2px edge and gives back 1px of
              // padding, so choosing one does not nudge the row
              <label
                key={o.value}
                className="flex h-9 cursor-pointer items-center gap-2 rounded-md border border-border-strong px-3 text-sm transition-colors duration-150 hover:bg-muted has-checked:border-2 has-checked:border-primary has-checked:px-[11px] has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring has-disabled:cursor-not-allowed has-disabled:opacity-50"
              >
                <input
                  type="radio"
                  name="rotate-grace"
                  value={o.value}
                  checked={grace === o.value}
                  onChange={() => setGrace(o.value)}
                  // the pill shows the ring; the dot itself does not repeat it
                  className="size-4 focus-visible:outline-none"
                />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>
        <p className="text-xs text-muted-foreground">
          Your server can also rotate a key with{' '}
          <code className="font-mono">POST /api/v1/keys/{'{id}'}/rotate</code>, using a key with the
          manage scope.
        </p>
        <InlineError error={rotate.error} title="Could not rotate the key" />
        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={rotate.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => void confirm()}
            disabled={rotate.isPending}
            aria-busy={rotate.isPending || undefined}
          >
            {rotate.isPending && <Spinner data-icon="inline-start" aria-hidden="true" />}
            {rotate.isPending ? 'Rotating…' : 'Rotate key'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
