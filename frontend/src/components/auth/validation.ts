// the server's limits (backend validation.ts and password.ts), checked here
// first so a slip is caught before a request spends one of the few attempts
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 256;
export const EMAIL_MAX = 254;
export const NAME_MAX = 100;

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function emailProblem(value: string): string | null {
  const v = value.trim();
  if (v === '') return 'Enter your email address.';
  if (v.length > EMAIL_MAX) return `Use at most ${EMAIL_MAX} characters.`;
  if (!EMAIL_SHAPE.test(v)) return 'Enter an email address like name@example.com.';
  return null;
}

export function nameProblem(value: string): string | null {
  const v = value.trim();
  if (v === '') return 'Enter your name.';
  if ([...v].length > NAME_MAX) return `Use at most ${NAME_MAX} characters.`;
  return null;
}

/** A password being chosen now. Code points, as the server counts them. */
export function newPasswordProblem(value: string): string | null {
  const length = [...value].length;
  if (length === 0) return 'Enter a password.';
  if (length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  return null;
}

export function confirmProblem(password: string, confirm: string): string | null {
  if (confirm === '') return 'Enter the password again.';
  return confirm === password ? null : 'The passwords do not match.';
}
