import { RateLimitError, SlubyError } from '@sluby/sdk';

// same-origin json client for the studio. the session cookie authenticates
// every call; endpoints the sdk covers go through `sluby` (lib/sluby.ts)
// instead, this is for the studio-only surfaces (keys, stats, webhooks, ...).

const API_PREFIX = '/api/v1';

/**
 * How long a studio request may take before it gives up, for apiClient and
 * the sdk client alike. Every studio call is a small json request; uploads go
 * through tus, which has its own retries and no such limit.
 */
export const REQUEST_TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** What the server sent along with the message, such as the invalid fields. */
    public readonly details?: unknown,
    /** Seconds the server asked to wait (Retry-After on a 429 or 503). */
    public readonly retryAfter?: number,
    /** The whole json body, for fields beside the message such as a 401's `reason`. */
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** A request that got no answer within its timeout. It has no status. */
export class RequestTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super(`No answer within ${timeoutMs / 1000} seconds`);
    this.name = 'TimeoutError';
  }
}

/**
 * The http status behind an error from apiClient or from the sdk, or
 * undefined when there was no response (network failure, abort).
 */
export function statusOf(err: unknown): number | undefined {
  if (err instanceof ApiError) return err.status;
  if (err instanceof SlubyError && err.statusCode > 0) return err.statusCode;
  return undefined;
}

/** Seconds to wait from a 429, from apiClient or the sdk; undefined when not said. */
export function retryAfterOf(err: unknown): number | undefined {
  if (err instanceof ApiError) return err.retryAfter;
  if (err instanceof RateLimitError) return err.retryAfter;
  return undefined;
}

/**
 * Seconds from a Retry-After header, which is either a number of seconds or
 * an http date (RFC 9110).
 */
export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

function buildUrl(path: string): string {
  return path.startsWith('/api/') ? path : `${API_PREFIX}${path}`;
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = JSON.parse(await response.text());
  } catch {
    // not json (a proxy's html error page, say); the status line has to do
  }
  const field = (name: string) => {
    const v = (body as Record<string, unknown> | null | undefined)?.[name];
    return typeof v === 'string' && v.trim() !== '' ? v : undefined;
  };
  return new ApiError(
    response.status,
    field('error') ?? field('message') ?? `HTTP ${response.status}`,
    (body as { details?: unknown } | undefined)?.details,
    parseRetryAfter(response.headers.get('Retry-After')),
    body,
  );
}

async function parse<T>(response: Response): Promise<T> {
  if (!response.ok) throw await toApiError(response);
  const text = await response.text();
  if (response.status === 204 || text === '') return undefined as T;
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return text as unknown as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(response.status, 'The server answered with malformed JSON');
  }
}

export interface RequestOptions {
  /** Cancels the request, such as react query's signal for a query. */
  signal?: AbortSignal;
  /** Overrides REQUEST_TIMEOUT_MS for this call. */
  timeoutMs?: number;
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  { signal, timeoutMs = REQUEST_TIMEOUT_MS }: RequestOptions = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (typeof init.body === 'string') headers.set('Content-Type', 'application/json');
  // one signal that fires on the caller's abort or the timeout; the timeout
  // also covers reading the body, so a stalled response cannot hang a card
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
  try {
    return await parse<T>(await fetch(buildUrl(path), { ...init, headers, signal: combined }));
  } catch (err) {
    if (timeout.signal.aborted && !signal?.aborted) throw new RequestTimeoutError(timeoutMs);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const json = (body: unknown) => (body != null ? JSON.stringify(body) : undefined);

export const apiClient = {
  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return request<T>(path, {}, options);
  },
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return request<T>(path, { method: 'POST', body: json(body) }, options);
  },
  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return request<T>(path, { method: 'PATCH', body: json(body) }, options);
  },
  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return request<T>(path, { method: 'DELETE' }, options);
  },
};
