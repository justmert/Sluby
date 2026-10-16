import { SlubyError } from '@sluby/sdk';

// same-origin json client for the studio. the session cookie authenticates
// every call; endpoints the sdk covers go through `sluby` (lib/sluby.ts)
// instead, this is for the studio-only surfaces (keys, stats, webhooks, ...).

const API_PREFIX = '/api/v1';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** What the server sent along with the message, such as the invalid fields. */
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (typeof init.body === 'string') headers.set('Content-Type', 'application/json');
  return parse<T>(await fetch(buildUrl(path), { ...init, headers }));
}

export const apiClient = {
  get<T>(path: string): Promise<T> {
    return request<T>(path);
  },
  post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: 'POST',
      body: body != null ? JSON.stringify(body) : undefined,
    });
  },
  patch<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: 'PATCH',
      body: body != null ? JSON.stringify(body) : undefined,
    });
  },
  delete<T>(path: string): Promise<T> {
    return request<T>(path, { method: 'DELETE' });
  },
};
