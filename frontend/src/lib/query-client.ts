import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { statusOf } from './api-client';
import { reportUnauthorized } from './session-events';

function onError(err: unknown) {
  if (statusOf(err) === 401) reportUnauthorized();
}

// a 4xx answer will not change on a second try; a 5xx or a network error might
function retry(failureCount: number, err: unknown): boolean {
  const status = statusOf(err);
  if (status !== undefined && status >= 400 && status < 500) return false;
  return failureCount < 1;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: { staleTime: 30_000, retry },
    },
  });
}

/** The Studio's one query client, also used outside react (the upload store). */
export const queryClient = createQueryClient();
