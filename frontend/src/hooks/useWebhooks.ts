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

export interface WebhookRecord {
  id: string;
  url: string;
  events: string[];
  is_active: boolean;
  created_at: string;
  secret?: string;
}

export interface CreateWebhookResponse {
  id: string;
  url: string;
  events: string[];
  secret: string;
}

export interface CreateWebhookParams {
  url: string;
  events: string[];
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useWebhooks(): UseQueryResult<{ data: WebhookRecord[] }> {
  return useQuery({
    queryKey: ['webhooks'],
    queryFn: () => apiClient.get<{ data: WebhookRecord[] }>('/webhooks'),
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
    refetchOnWindowFocus: false,
  });
}

export function useCreateWebhook(): UseMutationResult<
  CreateWebhookResponse,
  Error,
  CreateWebhookParams
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: CreateWebhookParams) =>
      apiClient.post<CreateWebhookResponse>('/webhooks', params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
    },
  });
}

export function useDeleteWebhook(): UseMutationResult<
  { success: boolean },
  Error,
  string
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete<{ success: boolean }>(`/webhooks/${id}`),
    onMutate: async (id) => {
      // Cancel any outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({ queryKey: ['webhooks'] });

      // Snapshot the previous value for rollback
      const previous = queryClient.getQueryData<{ data: WebhookRecord[] }>(['webhooks']);

      // Optimistically remove the webhook from the list
      if (previous) {
        queryClient.setQueryData<{ data: WebhookRecord[] }>(['webhooks'], {
          ...previous,
          data: previous.data.filter((webhook) => webhook.id !== id),
        });
      }

      return { previous };
    },
    onError: (_err, _id, context) => {
      // Roll back to the previous value on error
      if (context?.previous) {
        queryClient.setQueryData(['webhooks'], context.previous);
      }
    },
    onSettled: () => {
      // Always refetch after error or success to ensure server state
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
    },
  });
}
