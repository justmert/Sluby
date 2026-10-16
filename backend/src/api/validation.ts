import { z } from 'zod';
import { AppError } from './middleware/error-handler.js';

/**
 * Field rules shared by every way a value reaches the database, so the REST
 * routes and the tus creation hook accept exactly the same input.
 */

export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 5000;
export const KEY_NAME_MAX = 100;
// a guard against typos that would make a key unlimited in practice; the
// column itself is a 32-bit integer
export const RATE_LIMIT_MAX = 100_000;
export const ACCESS_TIERS = ['public', 'private'] as const;

const TAB = 0x09;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;

/**
 * Whether `value` holds a C0 control character or DEL. Postgres rejects NUL
 * in text, and the others in a one-line field are always a client mistake;
 * a multi-line field may keep tabs and line breaks.
 */
function hasControlCharacter(value: string, { multiLine = false } = {}): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0x20 && code !== 0x7f) continue;
    if (multiLine && (code === TAB || code === LINE_FEED || code === CARRIAGE_RETURN)) continue;
    return true;
  }
  return false;
}

export const titleSchema = z
  .string({ message: 'title must be a string' })
  .trim()
  .min(1, { message: 'title must not be empty' })
  .max(TITLE_MAX, { message: `title must be at most ${TITLE_MAX} characters` })
  .refine((v) => !hasControlCharacter(v), {
    message: 'title must not contain control characters',
  });

export const descriptionSchema = z
  .string({ message: 'description must be a string' })
  .max(DESCRIPTION_MAX, { message: `description must be at most ${DESCRIPTION_MAX} characters` })
  .refine((v) => !hasControlCharacter(v, { multiLine: true }), {
    message: 'description must not contain control characters other than tabs and line breaks',
  });

export const accessTierSchema = z.enum(ACCESS_TIERS, {
  message: `access_tier must be one of: ${ACCESS_TIERS.join(', ')}`,
});

export const PLAYBACK_ID_NAME_MAX = 100;

/** A playback ID's label; may be empty, it is only for telling them apart. */
export const playbackIdNameSchema = z
  .string({ message: 'name must be a string' })
  .trim()
  .max(PLAYBACK_ID_NAME_MAX, {
    message: `name must be at most ${PLAYBACK_ID_NAME_MAX} characters`,
  })
  .refine((v) => !hasControlCharacter(v), { message: 'name must not contain control characters' });

export const keyNameSchema = z
  .string({ message: 'name must be a string' })
  .trim()
  .min(1, { message: 'name is required' })
  .max(KEY_NAME_MAX, { message: `name must be at most ${KEY_NAME_MAX} characters` })
  .refine((v) => !hasControlCharacter(v), { message: 'name must not contain control characters' });

/**
 * A query parameter that must be a whole number in [min, max]. Express hands
 * over a string, or an array when the parameter repeats, so anything that is
 * not a plain run of digits is refused rather than coerced.
 */
export function integerParam(name: string, min: number, max: number) {
  const message = `${name} must be an integer from ${min} to ${max}`;
  return z
    .string({ message })
    .regex(/^[0-9]{1,10}$/, { message })
    .transform(Number)
    .refine((n) => n >= min && n <= max, { message });
}

/** A query parameter given at most once, as a string. */
export function stringParam(name: string) {
  return z.string({ message: `${name} must be given once, as a string` });
}

/**
 * Parse `input` or answer 400. The message names the first problem; every
 * problem is listed in `details` with the field it belongs to.
 */
export function parseOrThrow<S extends z.ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issues = result.error.issues.map((i) => ({
    field: i.path.map(String).join('.'),
    message: unknownKeyMessage(i) ?? i.message,
  }));
  const first = issues[0];
  const message =
    first.field && !first.message.includes(first.field)
      ? `${first.field}: ${first.message}`
      : first.message;
  throw new AppError(400, message, issues);
}

function unknownKeyMessage(issue: z.ZodIssue): string | undefined {
  if (issue.code !== 'unrecognized_keys') return undefined;
  const keys = (issue as unknown as { keys: string[] }).keys;
  return `unknown field${keys.length === 1 ? '' : 's'}: ${keys.join(', ')}`;
}
