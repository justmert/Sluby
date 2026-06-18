import { getStoredApiKey } from './api-key-store';

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4500';
const API_PREFIX = '/api/v1';

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildUrl(path: string): string {
  // If the path already starts with /api/v1, don't double-prefix
  const fullPath = path.startsWith('/api/') ? path : `${API_PREFIX}${path}`;
  return `${BASE_URL}${fullPath}`;
}

function authHeaders(): Record<string, string> {
  const key = getStoredApiKey();
  if (key) {
    return { Authorization: `Bearer ${key}` };
  }
  return {};
}

async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    ...authHeaders(),
    ...(options.headers as Record<string, string> ?? {}),
  };

  if (options.body && typeof options.body === 'string') {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(buildUrl(path), {
    ...options,
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    let errorBody: { message?: string; error?: string; details?: unknown } = {};
    try {
      errorBody = await response.json();
    } catch {
      // Non-JSON error response
    }
    throw new ApiError(
      response.status,
      errorBody.message ?? errorBody.error ?? `HTTP ${response.status}`,
      errorBody.details,
    );
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return response.json();
  }

  // Return text for non-JSON responses
  return response.text() as unknown as T;
}

// ---------------------------------------------------------------------------
// Public API methods
// ---------------------------------------------------------------------------

export const apiClient = {
  get<T>(path: string): Promise<T> {
    return request<T>(path, { method: 'GET' });
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

/**
 * Raw fetch that returns the full Response (useful for inspecting headers,
 * e.g. rate-limit headers in the API explorer).
 */
export async function apiRawFetch(
  path: string,
  options: RequestInit = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    ...authHeaders(),
    ...(options.headers as Record<string, string> ?? {}),
  };

  if (options.body && typeof options.body === 'string') {
    headers['Content-Type'] = 'application/json';
  }

  return fetch(buildUrl(path), { ...options, headers, credentials: 'include' });
}

/**
 * Fetch a path that is NOT under /api/v1 (e.g. /health, /metrics, /v1/cache/stats).
 */
export async function fetchRaw<T>(path: string): Promise<T> {
  const headers = authHeaders();
  const response = await fetch(`${BASE_URL}${path}`, {
    headers,
    credentials: 'include',
  });

  if (!response.ok) {
    let errorBody: { message?: string; error?: string; details?: unknown } = {};
    try {
      errorBody = await response.json();
    } catch {
      // Non-JSON error response
    }
    throw new ApiError(
      response.status,
      errorBody.message ?? errorBody.error ?? `HTTP ${response.status}`,
      errorBody.details,
    );
  }

  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return response.json();
  }
  return response.text() as unknown as T;
}

/** The base URL for TUS uploads (used by tus-js-client). */
export const TUS_ENDPOINT = `${BASE_URL}${API_PREFIX}/uploads`;

/** Export the base URL for use elsewhere. */
export { BASE_URL };
