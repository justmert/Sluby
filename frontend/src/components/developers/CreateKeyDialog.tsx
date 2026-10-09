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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useCreateApiKey, type IssuedKey, type KeyLimits } from '@/hooks/useApiKeys';
import { fieldErrorsOf } from '@/lib/errors';
import { formatCount } from '@/lib/formatters';
import {
  FIRST_INPUT,
  keyFormErrors,
  KEY_NAME_MAX,
  SERVER_FIELD,
  type FieldName,
  type KeyForm,
} from './forms';
import { OptionList } from './OptionList';
import { KEY_SCOPES } from './options';

/**
 * The form for a new key. The page owns the form values, so a draft can
 * outlive a session that ends while the dialog is open (FLW-15).
 */
export function CreateKeyDialog({
  open,
  onOpenChange,
  form,
  onFormChange,
  limits,
  onIssued,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: KeyForm;
  onFormChange: (form: KeyForm) => void;
  limits?: KeyLimits;
  onIssued: (key: IssuedKey) => void;
}) {
  const create = useCreateApiKey();
  // errors show once a field was left or a submit was tried, not while typing the first letter
  const [touched, setTouched] = useState<Partial<Record<FieldName, boolean>>>({});
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setTouched({});
  }

  const errors = keyFormErrors(form, limits?.maxRateLimit);
  const server = create.isError ? fieldErrorsOf(create.error) : {};
  const serverFor = (field: FieldName) =>
    Object.entries(server).find(([k]) => SERVER_FIELD[k] === field)?.[1] ?? null;
  const shown = (field: FieldName) => (touched[field] ? errors[field] : null) ?? serverFor(field);
  // a refusal not tied to one field (the key cap, the server down) shows below the fields
  const general =
    create.isError && Object.keys(server).every((k) => !(k in SERVER_FIELD)) ? create.error : null;

  const set = (patch: Partial<KeyForm>) => onFormChange({ ...form, ...patch });

  const close = (next: boolean) => {
    if (!next) create.reset();
    onOpenChange(next);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (create.isPending) return;
    const first = (['name', 'scopes', 'rateLimit'] as const).find((f) => errors[f]);
    if (first) {
      setTouched({ name: true, scopes: true, rateLimit: true });
      document.getElementById(FIRST_INPUT[first])?.focus();
      return;
    }
    try {
      const issued = await create.mutateAsync({
        name: form.name.trim(),
        scopes: form.scopes,
        rateLimit: Number(form.rateLimit),
      });
      // the secret now lives only in the dialog that shows it once
      create.reset();
      onOpenChange(false);
      onIssued(issued);
    } catch {
      // shown in the dialog, next to what can be changed
    }
  };

  const errorProps = (field: FieldName, id: string) => ({
    'aria-invalid': shown(field) ? true : undefined,
    'aria-describedby': shown(field) ? `${id}-error` : undefined,
  });

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>A key can do only what its scopes allow.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={!!shown('name') || undefined}>
              <FieldLabel htmlFor="key-name">Name</FieldLabel>
              <Input
                id="key-name"
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                placeholder="Production web app"
                maxLength={KEY_NAME_MAX}
                autoComplete="off"
                dir="auto"
                autoFocus
                {...errorProps('name', 'key-name')}
              />
              <FieldError id="key-name-error">{shown('name')}</FieldError>
            </Field>
            <OptionList
              legend="Scopes"
              options={KEY_SCOPES}
              value={form.scopes}
              onChange={(next) => {
                setTouched((t) => ({ ...t, scopes: true }));
                set({
                  scopes: KEY_SCOPES.map((s) => s.value).filter((v) => next.includes(v)),
                });
              }}
              idPrefix="key-scope"
              error={shown('scopes')}
            />
            <Field data-invalid={!!shown('rateLimit') || undefined}>
              <FieldLabel htmlFor="key-rate">Rate limit</FieldLabel>
              <Input
                id="key-rate"
                type="number"
                inputMode="numeric"
                min={1}
                max={limits?.maxRateLimit}
                step={1}
                value={form.rateLimit}
                onChange={(e) => set({ rateLimit: e.target.value })}
                onBlur={() => setTouched((t) => ({ ...t, rateLimit: true }))}
                className="w-32"
                aria-invalid={shown('rateLimit') ? true : undefined}
                aria-describedby={
                  shown('rateLimit') ? 'key-rate-help key-rate-error' : 'key-rate-help'
                }
              />
              <FieldDescription id="key-rate-help">
                {limits
                  ? `Requests per minute, up to ${formatCount(limits.maxRateLimit)}.`
                  : 'Requests per minute.'}
              </FieldDescription>
              <FieldError id="key-rate-error">{shown('rateLimit')}</FieldError>
            </Field>
          </FieldGroup>
          <InlineError error={general} title="Could not create the key" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={create.isPending}
              aria-busy={create.isPending || undefined}
            >
              {create.isPending && <Spinner data-icon="inline-start" aria-hidden="true" />}
              {create.isPending ? 'Creating…' : 'Create key'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
