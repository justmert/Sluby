import { SlubyError } from '@sluby/sdk';
import { ApiError, RequestTimeoutError, retryAfterOf, statusOf } from './api-client';

/*
 * every error the studio shows goes through here, so the reader never sees
 * "Internal Server Error", "HTTP 502", "Failed to fetch" or a proxy's html.
 * the wording follows the error map in resources/frontend-final-audit/copy.md:
 * say what happened, then what to do, in full sentences. the raw message is
 * kept as `detail` for a "Details" disclosure, never as the main text.
 *
 *   toast.error(withLead('Could not delete the video', err))
 *   <InlineError what="your API keys" error={query.error} onRetry={query.refetch} />
 */

export type ErrorKind =
  | 'offline'
  | 'timeout'
  | 'aborted'
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'conflict'
  | 'invalid'
  | 'too-large'
  | 'rate-limited'
  | 'server'
  | 'unknown';

/** What the reader can do about it, for the button an error state shows. */
export type ErrorAction = 'retry' | 'wait' | 'sign-in' | 'fix-input' | 'none';

export interface ErrorInfo {
  kind: ErrorKind;
  /** the http status, when there was a response */
  status?: number;
  /** one or two sentences for the reader: what happened, then what to do */
  message: string;
  action: ErrorAction;
  /** seconds the server asked to wait, from a 429 */
  retryAfter?: number;
  /** the raw text behind it, for a muted "Details" line; never the headline */
  detail?: string;
}

// backend messages a reader can act on, rewritten in the reader's words. the
// first match wins. each one names the route that sends it.
const KNOWN: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  // assets.ts, playback.ts, playback-ids.ts, sia-info.ts, retry.ts
  [/^Video asset not found/i, () => 'This video no longer exists. It may have been deleted.'],
  // error-handler.ts, a malformed id in the url
  [
    /^Invalid identifier format/i,
    () => 'Check the link. It may have been deleted, or it belongs to another account.',
  ],
  // assets.ts:258, polled while an upload hands over
  [/^No processing job found/i, () => 'Processing has not started yet.'],
  [/^Playback ID not found/i, () => 'That playback ID was already deleted.'],
  [/^Webhook endpoint not found/i, () => 'That webhook no longer exists.'],
  [/^API key not found/i, () => 'That API key no longer exists.'],
  [/^Session not found/i, () => 'That browser was already signed out.'],
  // error-handler.ts: no such route, so the server is older than the studio
  [
    /^Route [A-Z]+ \S+ not found$/,
    () => 'This server does not offer this yet. It may run an older version than the Studio.',
  ],
  // playback.ts:95, 99, 134, 192
  [
    /^Video (is not ready for playback|manifest not available)/i,
    () => 'This video is still processing. It can play once it is ready.',
  ],
  // keys.ts:135
  [
    /rate_limit must be at most (\d+)/i,
    (m) => `Enter a number from 1 to ${Number(m[1]).toLocaleString('en-US')}.`,
  ],
  // playback.ts:212, 217
  [
    /did not answer while minting share URLs/i,
    () => 'Could not start playback from Sia. Try again in a moment.',
  ],
  // api-key.ts:64
  [/^Only the platform identity or an operator/i, () => 'Only operators can do this.'],
  // uploads.ts:77
  [
    /^The upload is no longer in progress/i,
    () => 'The upload finished before it could be canceled.',
  ],
  [/^URL is required/i, () => 'Enter the URL that should get the events.'],
  [/^At least one event type is required/i, () => 'Choose at least one event.'],
  // upload-store.ts, made in the studio
  [/^An upload is already in progress/i, () => 'Another upload is running. Wait for it to finish.'],
];

const OFFLINE = 'Could not reach the server. Check your connection and try again.';
const TIMEOUT = 'The server did not answer in time. Try again in a moment.';
const SIGNED_OUT = 'Your session ended. Sign in again to continue.';
const FORBIDDEN = 'You do not have access to this. Ask an operator if you need it.';
const GONE = 'It no longer exists. It may have been deleted.';
const CONFLICT = 'This changed in the meantime. Refresh and try again.';
const INVALID = 'Some details are not valid. Check them and try again.';
const TOO_LARGE = 'This file is larger than the server accepts.';
const UNKNOWN = 'Something went wrong. Try again in a moment.';

const serverProblem = (status: number) =>
  `The server ran into a problem (error ${status}). Try again in a moment. If it keeps happening, check the server logs.`;

const rateLimited = (seconds: number | undefined) =>
  `Too many requests. Wait ${seconds === undefined ? 'a few' : seconds.toLocaleString('en-US')} ${seconds === 1 ? 'second' : 'seconds'} and try again.`;

/** The raw text of an error, whatever it is. */
function rawMessage(err: unknown): string | undefined {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return undefined;
}

/**
 * A server message that is fit to show as is: a sentence, not markup, not a
 * status line, not a stack. Validation messages from the backend pass; a
 * proxy's page or "HTTP 502" does not.
 */
function readable(message: string | undefined): message is string {
  if (!message) return false;
  const text = message.trim();
  if (text.length === 0 || text.length > 200) return false;
  if (text.startsWith('<') || /[\r\n]/.test(text)) return false;
  if (
    /^(HTTP \d{3}|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout|Failed to fetch|Unknown API error)$/i.test(
      text,
    )
  ) {
    return false;
  }
  return true;
}

/** "rate_limit: must be at most 10" reads as "Rate limit: must be at most 10." */
function sentence(text: string): string {
  const t = text.trim().replace(/^(\w+)_(\w+)/, (_m, a: string, b: string) => `${a} ${b}`);
  const capped = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}

function known(message: string | undefined): string | undefined {
  if (!message) return undefined;
  for (const [pattern, text] of KNOWN) {
    const m = message.match(pattern);
    if (m) return text(m);
  }
  return undefined;
}

const isAbort = (err: unknown) => err instanceof Error && err.name === 'AbortError';
/** No answer in time: apiClient's own timeout, the sdk's, or an AbortSignal.timeout. */
export const isTimeout = (err: unknown) =>
  err instanceof RequestTimeoutError || (err instanceof Error && err.name === 'TimeoutError');
// fetch rejects with a TypeError when there is no response at all
const isNetwork = (err: unknown) =>
  err instanceof TypeError ||
  (err instanceof SlubyError && err.statusCode === 0 && err.cause instanceof TypeError);

/** Everything the ui needs to show an error: the words, the action and the raw detail. */
export function describeError(err: unknown): ErrorInfo {
  const raw = rawMessage(err);
  const status = statusOf(err);

  if (status === undefined) {
    if (isAbort(err))
      return { kind: 'aborted', message: 'The request was canceled.', action: 'none' };
    if (isTimeout(err)) return { kind: 'timeout', message: TIMEOUT, action: 'retry', detail: raw };
    if (isNetwork(err)) return { kind: 'offline', message: OFFLINE, action: 'retry', detail: raw };
    // made in the studio (the upload store, a parser): known ones read well
    const mapped = known(raw);
    if (mapped) return { kind: 'unknown', message: mapped, action: 'retry', detail: raw };
    if (/malformed JSON|without a signature|no valid timestamp/i.test(raw ?? '')) {
      return { kind: 'server', message: UNKNOWN, action: 'retry', detail: raw };
    }
    return { kind: 'unknown', message: UNKNOWN, action: 'retry', detail: raw };
  }

  const base = { status, detail: raw };
  if (status === 401)
    return { ...base, kind: 'unauthorized', message: SIGNED_OUT, action: 'sign-in' };
  if (status === 429) {
    const retryAfter = retryAfterOf(err);
    return {
      ...base,
      kind: 'rate-limited',
      message: rateLimited(retryAfter),
      action: 'wait',
      retryAfter,
    };
  }
  if (status >= 500) {
    // a 5xx with a real sentence from the app (playback's "did not answer")
    const mapped = known(raw);
    return { ...base, kind: 'server', message: mapped ?? serverProblem(status), action: 'retry' };
  }

  const mapped = known(raw);
  switch (status) {
    case 403:
      return { ...base, kind: 'forbidden', message: mapped ?? FORBIDDEN, action: 'none' };
    case 404:
      return { ...base, kind: 'not-found', message: mapped ?? GONE, action: 'none' };
    case 410:
      // gone for good, and the server says what to do instead (retry.ts)
      return {
        ...base,
        kind: 'not-found',
        message: mapped ?? (readable(raw) ? sentence(raw) : GONE),
        action: 'none',
      };
    case 409:
      return {
        ...base,
        kind: 'conflict',
        message: mapped ?? (readable(raw) ? sentence(raw) : CONFLICT),
        action: 'retry',
      };
    case 413:
      return { ...base, kind: 'too-large', message: TOO_LARGE, action: 'none' };
    case 400:
    case 422:
      if (/^Invalid identifier format/i.test(raw ?? '')) {
        return { ...base, kind: 'not-found', message: mapped!, action: 'none' };
      }
      return {
        ...base,
        kind: 'invalid',
        message: mapped ?? (readable(raw) ? sentence(raw) : INVALID),
        action: 'fix-input',
      };
    default:
      return {
        ...base,
        kind: 'unknown',
        message: mapped ?? (readable(raw) ? sentence(raw) : UNKNOWN),
        action: 'retry',
      };
  }
}

/** The reader's sentence for an error. */
export function errorText(err: unknown): string {
  return describeError(err).message;
}

/**
 * A lead sentence plus the error, for toasts and alerts:
 * withLead('Could not delete the video', err) gives
 * "Could not delete the video. The server ran into a problem (error 500). ..."
 * The lead takes no trailing period; it gets one here.
 */
export function withLead(lead: string, err: unknown): string {
  const head = lead.trim().replace(/[.:]$/, '');
  const text = errorText(err);
  // a server sentence that already opens with the lead says it once
  if (text.toLowerCase().startsWith(head.toLowerCase())) return text;
  return `${head}. ${text}`;
}

/** The `details` a 400 carries, from apiClient or from the sdk's raw response body. */
function detailsOf(err: unknown): unknown {
  if (err instanceof ApiError) return err.details;
  if (err instanceof SlubyError && err.responseBody) {
    try {
      return (JSON.parse(err.responseBody) as { details?: unknown }).details;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Field errors from a 400 the backend validated, keyed by field name
 * (`rate_limit`, `url`), so a form can show each one next to its field. Empty
 * when the error carries none.
 */
export function fieldErrorsOf(err: unknown): Record<string, string> {
  const details = detailsOf(err);
  if (!Array.isArray(details)) return {};
  const out: Record<string, string> = {};
  for (const issue of details as Array<{ field?: unknown; message?: unknown }>) {
    if (typeof issue?.field !== 'string' || typeof issue.message !== 'string') continue;
    if (issue.field in out) continue;
    out[issue.field] = known(issue.message) ?? sentence(issue.message);
  }
  return out;
}
