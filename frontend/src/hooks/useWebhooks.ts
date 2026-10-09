import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export interface WebhookRecord {
  id: string;
  url: string;
  events: string[];
  is_active: boolean;
  created_at: string;
  /** When the newest delivery was attempted; null before any. B-07: absent until the server has it. */
  last_delivery_at?: string | null;
  /** Whether that delivery reached the endpoint; null before any. B-07. */
  last_delivery_ok?: boolean | null;
  /** Only on the stand-in row shown while the server adds the endpoint. */
  pending?: true;
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
  /** The JSON body that was sent. B-06: absent until the server has it. */
  payload?: unknown;
  /** True for a resend from the studio or the api. B-05/B-06. */
  manual?: boolean;
}

export interface WebhookTestResult {
  delivered: boolean;
  status_code: number | null;
  error: string | null;
}

const KEY = ['webhooks'];
const deliveriesKey = (id: string) => ['webhooks', id, 'deliveries'];

type HookList = { data: WebhookRecord[] };

function editHooks(qc: QueryClient, edit: (rows: WebhookRecord[]) => WebhookRecord[]) {
  qc.setQueryData<HookList>(KEY, (old) => (old ? { ...old, data: edit(old.data) } : old));
}

export function useWebhooks() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => apiClient.get<HookList>('/webhooks'),
  });
}

let pendingSeq = 0;

export function useCreateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { url: string; events: string[] }) =>
      apiClient.post<CreatedWebhook>('/webhooks', body),
    // the response holds the signing secret; do not keep it once handed over
    gcTime: 0,
    // newest first, like the server lists them
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: KEY, exact: true });
      const id = `pending-${++pendingSeq}`;
      editHooks(qc, (rows) => [
        { id, ...body, is_active: true, created_at: new Date().toISOString(), pending: true },
        ...rows,
      ]);
      return { id };
    },
    onSuccess: (created, _body, ctx) =>
      editHooks(qc, (rows) =>
        rows.map((r) =>
          r.id === ctx.id
            ? // the secret stays out of the query cache
              {
                id: created.id,
                url: created.url,
                events: created.events,
                is_active: true,
                created_at: r.created_at,
              }
            : r,
        ),
      ),
    onError: (_err, _body, ctx) => {
      if (ctx) editHooks(qc, (rows) => rows.filter((r) => r.id !== ctx.id));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.delete<{ success: boolean }>(`/webhooks/${id}`),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: KEY, exact: true });
      const rows = qc.getQueryData<HookList>(KEY)?.data ?? [];
      const index = rows.findIndex((r) => r.id === id);
      editHooks(qc, (list) => list.filter((r) => r.id !== id));
      return { removed: index >= 0 ? rows[index] : null, index };
    },
    // back where it was, so the list does not reshuffle on a failure
    onError: (_err, _id, ctx) => {
      const back = ctx?.removed;
      if (!back) return;
      editHooks(qc, (rows) =>
        rows.some((r) => r.id === back.id)
          ? rows
          : [...rows.slice(0, ctx.index), back, ...rows.slice(ctx.index)],
      );
    },
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

/** How a webhook is named in titles and crumbs: its host and path, without the scheme. */
export function webhookLabel(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname;
    return `${u.host}${path}`;
  } catch {
    return url;
  }
}
