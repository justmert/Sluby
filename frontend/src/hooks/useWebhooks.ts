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

/** A new signing secret, from POST /webhooks/:id/rotate-secret (B-04). */
export interface RotatedSecret {
  id: string;
  secret: string;
}

export type WebhookPatch = { url?: string; events?: string[]; is_active?: boolean };

const KEY = ['webhooks'];
const oneKey = (id: string) => ['webhooks', 'one', id];
const deliveriesKey = (id: string) => ['webhooks', id, 'deliveries'];

/** How often the delivery log refreshes while its page is on screen. */
export const DELIVERIES_POLL_MS = 10_000;

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

/**
 * One endpoint (GET /webhooks/:id, B-07). Coming from the list, it shows the
 * listed copy at once while the request runs.
 */
export function useWebhook(id: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: oneKey(id),
    queryFn: () => apiClient.get<WebhookRecord>(`/webhooks/${encodeURIComponent(id)}`),
    placeholderData: () => qc.getQueryData<HookList>(KEY)?.data.find((w) => w.id === id),
  });
}

function storeHook(qc: QueryClient, hook: WebhookRecord) {
  qc.setQueryData(oneKey(hook.id), hook);
  editHooks(qc, (rows) => rows.map((r) => (r.id === hook.id ? hook : r)));
}

export function useCreateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { url: string; events: string[] }) =>
      apiClient.post<CreatedWebhook>('/webhooks', body),
    // the response holds the signing secret; do not keep it once handed over
    gcTime: 0,
    // the row goes in once the server added the endpoint, newest first; the
    // secret stays out of the query cache
    onSuccess: (created) =>
      editHooks(qc, (rows) => [
        {
          id: created.id,
          url: created.url,
          events: created.events,
          is_active: true,
          created_at: new Date().toISOString(),
          last_delivery_at: null,
          last_delivery_ok: null,
        },
        ...rows.filter((r) => r.id !== created.id),
      ]),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY, exact: true }),
  });
}

/** Change the url or events, or pause and resume (PATCH /webhooks/:id, B-03). */
export function useUpdateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: WebhookPatch }) =>
      apiClient.patch<WebhookRecord>(`/webhooks/${encodeURIComponent(id)}`, patch),
    onSuccess: (hook) => storeHook(qc, hook),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** A new signing secret, shown once; the old one stops at once (B-04). */
export function useRotateWebhookSecret() {
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.post<RotatedSecret>(`/webhooks/${encodeURIComponent(id)}/rotate-secret`),
    gcTime: 0,
  });
}

/** Queue a logged delivery again with the same event id (B-05). */
export function useRedeliver(webhookId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (deliveryId: string) =>
      apiClient.post<{ delivery_id: string }>(
        `/webhooks/${encodeURIComponent(webhookId)}/deliveries/${encodeURIComponent(deliveryId)}/redeliver`,
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: deliveriesKey(webhookId) }),
  });
}

/** Delete an endpoint; the row leaves once the server confirms. */
export function useDeleteWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.delete<{ success: boolean }>(`/webhooks/${encodeURIComponent(id)}`),
    onSuccess: (_res, id) => {
      editHooks(qc, (rows) => rows.filter((r) => r.id !== id));
      qc.removeQueries({ queryKey: oneKey(id) });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY, exact: true }),
  });
}

/** Send a signed `webhook.test` event now and report how the receiver answered. */
export function useTestWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient.post<WebhookTestResult>(`/webhooks/${encodeURIComponent(id)}/test`),
    onSettled: (_data, _err, id) => {
      void qc.invalidateQueries({ queryKey: deliveriesKey(id) });
      // the last delivery shown in the list and the header changed too
      void qc.invalidateQueries({ queryKey: KEY, exact: true });
      void qc.invalidateQueries({ queryKey: oneKey(id) });
    },
  });
}

/**
 * The endpoint's latest delivery attempts, newest first. Refreshes every 10
 * seconds while the tab is visible (react query pauses the interval when it
 * is hidden).
 */
export function useWebhookDeliveries(id: string) {
  return useQuery({
    queryKey: deliveriesKey(id),
    queryFn: () =>
      apiClient.get<{ data: WebhookDelivery[] }>(
        `/webhooks/${encodeURIComponent(id)}/deliveries?limit=50`,
      ),
    refetchInterval: DELIVERIES_POLL_MS,
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
