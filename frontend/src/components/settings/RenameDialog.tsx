import { AuthField, FormError } from '@/components/auth/fields';
import { useAuthForm } from '@/components/auth/use-auth-form';
import { NAME_MAX, nameProblem } from '@/components/auth/validation';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useRename } from '@/hooks/useAccount';
import { useRefreshSession } from '@/lib/session';
import { toastSuccess } from '@/lib/toast';

/** The form, mounted only while the dialog is open, so it starts from the current name. */
function RenameForm({
  name,
  onDone,
  onCancel,
}: {
  name: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const rename = useRename();
  const refresh = useRefreshSession();
  const form = useAuthForm<'name'>({
    initial: { name },
    validate: (v) => ({ name: nameProblem(v.name) }),
    idOf: () => 'rename-name',
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const sent = await form.submit(async (v) => {
      await rename.mutateAsync(v.name.trim());
      await refresh();
    });
    if (!sent) return;
    onDone();
    toastSuccess('Name changed.');
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <DialogHeader>
        <DialogTitle>Change your name</DialogTitle>
        <DialogDescription>Your team sees it on the Members page.</DialogDescription>
      </DialogHeader>
      <AuthField
        id="rename-name"
        label="Name"
        error={form.shown('name')}
        input={(props) => (
          <Input
            {...props}
            autoComplete="name"
            maxLength={NAME_MAX}
            dir="auto"
            value={form.values.name}
            onChange={(e) => form.set('name')(e.target.value)}
            onBlur={form.touch('name')}
          />
        )}
      />
      <FormError error={form.general} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={form.pending} aria-busy={form.pending || undefined}>
          {form.pending && <Spinner data-icon="inline-start" aria-hidden="true" />}
          {form.pending ? 'Saving…' : 'Save name'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Change the signed-in member's own name. */
export function RenameDialog({
  open,
  onOpenChange,
  name,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <RenameForm
          name={name}
          onDone={() => onOpenChange(false)}
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
