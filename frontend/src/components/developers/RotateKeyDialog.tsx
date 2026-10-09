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
import { Field, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useFrozen } from '@/hooks/useFrozen';
import { useRotateApiKey, type ApiKeyRecord, type IssuedKey } from '@/hooks/useApiKeys';
import { statusOf } from '@/lib/api-client';
import { toastError } from '@/lib/toast';
import { keyLabel } from './key-label';
import { GRACE_OPTIONS } from './options';

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
  const [grace, setGrace] = useState('0');
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setGrace('0');
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
        <Field>
          <FieldLabel htmlFor="rotate-grace">Keep the old key working for</FieldLabel>
          <Select value={grace} onValueChange={setGrace} disabled={rotate.isPending}>
            <SelectTrigger id="rotate-grace" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GRACE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
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
