import type { KeyScope } from '@/hooks/useApiKeys';
import { formatCount } from '@/lib/formatters';
import { DEFAULT_EVENTS, DEFAULT_RATE_LIMIT, DEFAULT_SCOPES, KEY_SCOPES } from './options';

// the values and checks of the create key and add webhook forms, kept apart
// from the dialogs so the pages can own the values (drafts survive a session
// that ends, FLW-15)

export interface KeyForm {
  name: string;
  scopes: KeyScope[];
  /** as typed, so a half-typed number is kept */
  rateLimit: string;
}

export const KEY_NAME_MAX = 100;

export const emptyKeyForm = (): KeyForm => ({
  name: '',
  scopes: DEFAULT_SCOPES,
  rateLimit: String(DEFAULT_RATE_LIMIT),
});

export type FieldName = 'name' | 'scopes' | 'rateLimit';

export function keyFormErrors(f: KeyForm, maxRate?: number): Record<FieldName, string | null> {
  const rate = Number(f.rateLimit);
  let rateLimit: string | null = null;
  if (f.rateLimit.trim() === '' || !Number.isInteger(rate) || rate < 1) {
    rateLimit = 'Enter a whole number, 1 or more.';
  } else if (maxRate !== undefined && rate > maxRate) {
    rateLimit = `Use at most ${formatCount(maxRate)} requests per minute.`;
  }
  return {
    name: f.name.trim() === '' ? 'Enter a name.' : null,
    scopes: f.scopes.length === 0 ? 'Choose at least one scope.' : null,
    rateLimit,
  };
}

// the api names its fields in snake case
export const SERVER_FIELD: Record<string, FieldName> = {
  name: 'name',
  scopes: 'scopes',
  rate_limit: 'rateLimit',
};

export const FIRST_INPUT: Record<FieldName, string> = {
  name: 'key-name',
  scopes: `key-scope-${KEY_SCOPES[0].value}`,
  rateLimit: 'key-rate',
};

export interface WebhookForm {
  url: string;
  events: string[];
}

/** Longest receiver URL the server accepts (B-17). */
export const WEBHOOK_URL_MAX = 2048;

export const emptyWebhookForm = (): WebhookForm => ({ url: '', events: DEFAULT_EVENTS });

export function urlProblem(raw: string): string | null {
  const url = raw.trim();
  if (url === '') return 'Enter the URL that should get the events.';
  if (url.length > WEBHOOK_URL_MAX) return 'Use a URL of at most 2,048 characters.';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'Enter a full URL, such as https://example.com/sluby-hook.';
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return 'The URL must start with https:// or http://.';
  }
  return null;
}
