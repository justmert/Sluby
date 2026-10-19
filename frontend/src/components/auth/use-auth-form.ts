import { useState } from 'react';
import { fieldErrorsOf } from '@/lib/errors';

type Values<F extends string> = Record<F, string>;
type Problems<F extends string> = Partial<Record<F, string | null>>;

/**
 * The state of one signed-out form: values, which fields to judge yet, the
 * request in flight and its failure. Errors show once a field was left or a
 * submit was tried, and a server error about a field shows next to it until
 * that field changes.
 *
 * `idOf` gives each field's input id, to focus the first one that is wrong;
 * `serverField` maps the api's field names to the form's.
 */
export function useAuthForm<F extends string>({
  initial,
  validate,
  idOf,
  serverField = {},
}: {
  initial: Values<F>;
  validate: (values: Values<F>) => Problems<F>;
  idOf: (field: F) => string;
  serverField?: Record<string, F>;
}) {
  const [values, setValues] = useState(initial);
  const [touched, setTouched] = useState<Partial<Record<F, boolean>>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  // fields edited since the server answered, whose server error is stale
  const [edited, setEdited] = useState<Partial<Record<F, boolean>>>({});

  const problems = validate(values);
  const fields = Object.keys(initial) as F[];

  const server: Problems<F> = {};
  for (const [apiField, message] of Object.entries(fieldErrorsOf(error))) {
    const field =
      serverField[apiField] ?? (fields.includes(apiField as F) ? (apiField as F) : null);
    if (field && !edited[field]) server[field] = message;
  }

  const shown = (field: F): string | null =>
    (touched[field] ? problems[field] : null) ?? server[field] ?? null;

  /** The error that belongs to no field, for the block under the form. */
  const general = error !== null && Object.keys(server).length === 0 ? error : null;

  const set = (field: F) => (value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    setEdited((e) => ({ ...e, [field]: true }));
  };

  const touch = (field: F) => () => setTouched((t) => ({ ...t, [field]: true }));

  /**
   * Check the fields, then run `send`. Resolves true when it succeeded; the
   * form stays pending then, since a new screen replaces it.
   */
  const submit = async (send: (values: Values<F>) => Promise<unknown>): Promise<boolean> => {
    if (pending) return false;
    const first = fields.find((f) => problems[f]);
    if (first) {
      setTouched(Object.fromEntries(fields.map((f) => [f, true])) as Record<F, boolean>);
      document.getElementById(idOf(first))?.focus();
      return false;
    }
    setPending(true);
    setError(null);
    try {
      await send(values);
      return true;
    } catch (err) {
      setError(err);
      setEdited({});
      setPending(false);
      const wrong = Object.entries(fieldErrorsOf(err))
        .map(([k]) => serverField[k] ?? (fields.includes(k as F) ? (k as F) : null))
        .find((f): f is F => f !== null);
      if (wrong) document.getElementById(idOf(wrong))?.focus();
      return false;
    }
  };

  /** Back to idle with `err` shown, for a failure found after the request. */
  const fail = (err: unknown) => {
    setError(err);
    setPending(false);
  };

  return { values, set, touch, shown, general, error, pending, submit, fail };
}
