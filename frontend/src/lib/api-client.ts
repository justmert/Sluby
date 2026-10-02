// same-origin json client for the studio. the session cookie authenticates
// every call; endpoints the sdk covers go through `sluby` (lib/sluby.ts)
// instead, this is for the studio-only surfaces (keys, stats, webhooks, ...).

const API_PREFIX = '/api/v1';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function buildUrl(path: string): string {
  return path.startsWith('/api/') ? path : `${API_PREFIX}${path}`;
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: { message?: string; error?: string; details?: unknown } = {};
  try {
    body = await response.json();
  } catch {
    // not json, keep the status line
  }
  return new ApiError(
    response.status,
    body.error ?? body.message ?? `HTTP ${response.status}`,
    body.details,
  );
}

async function parse<T>(response: Response): Promise<T> {
  if (!response.ok) throw await toApiError(response);
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) return response.json();
  return response.text() as unknown as T;
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

/** Raw fetch under /api/v1 that returns the full Response (headers included). */
export function apiRawFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (typeof init.body === 'string') headers.set('Content-Type', 'application/json');
  return fetch(buildUrl(path), { ...init, headers });
}

/** Fetch a path outside /api/v1 (e.g. /v1/cache/stats). */
export async function fetchRaw<T>(path: string): Promise<T> {
  return parse<T>(await fetch(path));
}
