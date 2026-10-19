import { useState, type ComponentProps, type ReactNode } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { authErrorText } from './sign-in-copy';

/**
 * A password box with a show and hide toggle. The toggle keeps one name and
 * says whether it is on with aria-pressed, so a screen reader hears the state.
 */
export function PasswordInput({
  autoComplete,
  ...props
}: Omit<ComponentProps<'input'>, 'type'> & {
  autoComplete: 'current-password' | 'new-password';
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input
        {...props}
        type={shown ? 'text' : 'password'}
        autoComplete={autoComplete}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className="pr-11"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground"
        aria-label="Show password"
        aria-pressed={shown}
        aria-controls={props.id}
        onClick={() => setShown((s) => !s)}
      >
        {shown ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
      </Button>
    </div>
  );
}

/**
 * A labelled field with its error under it. `input` receives the props that
 * tie it to the label, the hint and the error.
 */
export function AuthField({
  id,
  label,
  error,
  hint,
  input,
}: {
  id: string;
  label: string;
  error: string | null;
  hint?: ReactNode;
  input: (props: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string }) => ReactNode;
}) {
  const described = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(' ');
  return (
    <Field data-invalid={!!error || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {input({
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': described || undefined,
      })}
      {hint && <FieldDescription id={`${id}-hint`}>{hint}</FieldDescription>}
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </Field>
  );
}

/** A failure that belongs to no one field, under the form. */
export function FormError({ error }: { error: unknown }) {
  if (error === null || error === undefined) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {authErrorText(error)}
    </p>
  );
}
