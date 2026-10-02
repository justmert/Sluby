import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export interface WebhookRecord {
  id: string;
  url: string;
  events: string[];
  is_active: boolean;
  created_at: string;
}

/** The creation response, the only time the signing secret is returned. */
export interface CreatedWebhook {
  id: string;
  url: string;
  events: string[];
  secret: string;
}

const KEY = ['webhooks'];

export function useWebhooks() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => apiClient.get<{ data: WebhookRecord[] }>('/webhooks'),
  });
}

export function useCreateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { url: string; events: string[] }) =>
      apiClient.post<CreatedWebhook>('/webhooks', body),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<{ success: boolean }>(`/webhooks/${id}`),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
