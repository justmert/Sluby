import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { retryAfterOf, statusOf } from './api-client';
import { reportUnauthorized } from './session-events';

function onError(err: unknown) {
  if (statusOf(err) === 401) reportUnauthorized();
}

// a 4xx answer will not change on a second try; a 5xx, a timeout or a network
// error might. a 429 is worth one more try once the server's wait is over.
export function retry(failureCount: number, err: unknown): boolean {
  const status = statusOf(err);
  if (status === 429) return failureCount < 1 && (retryAfterOf(err) ?? 0) <= 30;
  if (status !== undefined && status >= 400 && status < 500) return false;
  return failureCount < 1;
}

// waits as long as a 429 asked, else react query's usual backoff
export function retryDelay(failureCount: number, err: unknown): number {
  const after = retryAfterOf(err);
  if (after !== undefined) return Math.min(after, 30) * 1000;
  return Math.min(1000 * 2 ** failureCount, 30_000);
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: { staleTime: 30_000, retry, retryDelay },
    },
  });
}

/** The Studio's one query client, also used outside react (the upload store). */
export const queryClient = createQueryClient();
