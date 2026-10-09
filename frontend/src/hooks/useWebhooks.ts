import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type {
  CreatedWebhookEndpoint,
  UpdateWebhookEndpointInput,
  WebhookDelivery as SdkDelivery,
  WebhookEndpoint,
  WebhookEventName,
} from '@sluby/sdk';
import { sluby } from '@/lib/sluby';

export type WebhookRecord = WebhookEndpoint;
export type CreatedWebhook = CreatedWebhookEndpoint;
export type WebhookDelivery = SdkDelivery;
export type WebhookPatch = UpdateWebhookEndpointInput;
export type { WebhookEventName };

const KEY = ['webhooks'];
const oneKey = (id: string) => ['webhooks', 'one', id];
const deliveriesKey = (id: string) => ['webhooks', id, 'deliveries'];

/** How often the delivery log refreshes while its page is on screen. */
export const DELIVERIES_POLL_MS = 10_000;

type HookList = { data: WebhookRecord[] };

function editHooks(qc: QueryClient, edit: (rows: WebhookRecord[]) => WebhookRecord[]) {
  qc.setQueryData<HookList>(KEY, (old) => (old ? { ...old, data: edit(old.data) } : old));
}

/** The endpoint list; the nav polls it for its failed-delivery dot. */
export function useWebhooks({ refetchInterval }: { refetchInterval?: number } = {}) {
  return useQuery({
    queryKey: KEY,
    queryFn: async ({ signal }): Promise<HookList> => ({
      data: await sluby.webhookEndpoints.list({ signal }),
    }),
    refetchInterval,
  });
}

/**
 * One endpoint (GET /webhooks/:id, B-07). Coming from the list, it shows the
 * listed copy at once while the request runs.
 */
export function useWebhook(id: string) {
  const qc = useQueryClient();
  return useQuery<WebhookRecord>({
    queryKey: oneKey(id),
    queryFn: ({ signal }) => sluby.webhookEndpoints.get(id, { signal }),
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
    mutationFn: (body: { url: string; events: WebhookEventName[] }) =>
      sluby.webhookEndpoints.create(body),
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
          isActive: true,
          createdAt: new Date().toISOString(),
          lastDeliveryAt: null,
          lastDeliveryOk: null,
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
      sluby.webhookEndpoints.update(id, patch),
    onSuccess: (hook) => storeHook(qc, hook),
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** A new signing secret, shown once; the old one stops at once (B-04). */
export function useRotateWebhookSecret() {
  return useMutation({
    mutationFn: (id: string) => sluby.webhookEndpoints.rotateSecret(id),
    gcTime: 0,
  });
}

/** Queue a logged delivery again with the same event id (B-05). */
export function useRedeliver(webhookId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (deliveryId: string) => sluby.webhookEndpoints.redeliver(webhookId, deliveryId),
    onSettled: () => qc.invalidateQueries({ queryKey: deliveriesKey(webhookId) }),
  });
}

/** Delete an endpoint; the row leaves once the server confirms. */
export function useDeleteWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sluby.webhookEndpoints.delete(id),
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
    mutationFn: (id: string) => sluby.webhookEndpoints.test(id),
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
    queryFn: async ({ signal }) => ({
      data: await sluby.webhookEndpoints.deliveries(id, { limit: 50, signal }),
    }),
    refetchInterval: DELIVERIES_POLL_MS,
  });
}

// a crumb, a menu name or a toast holds this much; the page shows the whole url
const LABEL_MAX = 60;

/** How a webhook is named in titles and crumbs: its host and path, without the scheme. */
export function webhookLabel(url: string): string {
  let label = url;
  try {
    const u = new URL(url);
    label = `${u.host}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    // not a url: name it as typed
  }
  return label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 1)}…` : label;
}
