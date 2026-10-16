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

/** One delivery attempt, as GET /webhooks/:id/deliveries lists it. */
export interface WebhookDelivery {
  id: string;
  event_id: string | null;
  event: string;
  status_code: number | null;
  delivered: boolean;
  /** Why the attempt failed; null when it was delivered. */
  error: string | null;
  attempt: number;
  created_at: string;
}

export interface WebhookTestResult {
  delivered: boolean;
  status_code: number | null;
  error: string | null;
}

const KEY = ['webhooks'];
const deliveriesKey = (id: string) => ['webhooks', id, 'deliveries'];

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
    // the response holds the signing secret; do not keep it once handed over
    gcTime: 0,
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

/** Send a signed `webhook.test` event now and report how the receiver answered. */
export function useTestWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.post<WebhookTestResult>(`/webhooks/${id}/test`),
    onSettled: (_data, _err, id) => qc.invalidateQueries({ queryKey: deliveriesKey(id) }),
  });
}

/** The endpoint's latest delivery attempts, newest first. */
export function useWebhookDeliveries(id: string, enabled: boolean) {
  return useQuery({
    queryKey: deliveriesKey(id),
    queryFn: () =>
      apiClient.get<{ data: WebhookDelivery[] }>(`/webhooks/${id}/deliveries?limit=20`),
    enabled,
    refetchInterval: enabled ? 15_000 : false,
  });
}
