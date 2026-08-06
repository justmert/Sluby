import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryResult,
  type UseMutationResult,
} from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ApiKeyRecord {
  id: string;
  name: string;
  scopes: string[];
  rate_limit: number;
  is_active: boolean;
  created_at: string;
}

export interface CreateApiKeyResponse {
  id: string;
  key: string;
  name: string;
  scopes: string[];
}

export interface CreateApiKeyParams {
  name: string;
  scopes: string[];
  rate_limit?: number;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useApiKeys(): UseQueryResult<{ data: ApiKeyRecord[] }> {
  return useQuery({
    queryKey: ['api-keys'],
    queryFn: () => apiClient.get<{ data: ApiKeyRecord[] }>('/keys'),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
    refetchOnWindowFocus: false,
  });
}

export function useCreateApiKey(): UseMutationResult<
  CreateApiKeyResponse,
  Error,
  CreateApiKeyParams
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: CreateApiKeyParams) =>
      apiClient.post<CreateApiKeyResponse>('/keys', params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });
}

export function useDeleteApiKey(): UseMutationResult<{ success: boolean }, Error, string> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete<{ success: boolean }>(`/keys/${id}`),
    onMutate: async (id) => {
      // Cancel any outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: ['api-keys'] });

      // Snapshot the previous value for rollback
      const previous = queryClient.getQueryData<{ data: ApiKeyRecord[] }>(['api-keys']);

      // Optimistically remove the key from the list
      if (previous) {
        queryClient.setQueryData<{ data: ApiKeyRecord[] }>(['api-keys'], {
          ...previous,
          data: previous.data.filter((key) => key.id !== id),
        });
      }

      return { previous };
    },
    onError: (_err, _id, context) => {
      // Roll back to the previous value on error
      if (context?.previous) {
        queryClient.setQueryData(['api-keys'], context.previous);
      }
    },
    onSettled: () => {
      // Always refetch after error or success to ensure server state
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  });
}
