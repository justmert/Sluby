import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, statusOf } from '@/lib/api-client';

export interface AssetStats {
  total: number;
  by_status: Record<'created' | 'uploading' | 'processing' | 'ready' | 'failed', number>;
  stored_bytes: number;
  ready_duration_ms: number;
  object_count: number;
}

export interface Probe {
  ok: boolean;
  latency_ms: number;
  /** Only in the deployment view: probe errors can name internal hosts. */
  error?: string;
}

export interface HostPool {
  total: number;
  good_for_upload: number;
  countries: number;
}

interface StatusCommon {
  status: 'ok' | 'degraded' | 'down';
  checked_at: string;
  version: string;
  database: Probe;
  redis: Probe;
}

/** What an ordinary account sees: whether each dependency answers, and the host pool. */
export interface AccountStatus extends StatusCommon {
  scope: 'account';
  indexer: Omit<Probe, 'error'> & { network: string; hosts: HostPool | null };
}

export interface IndexerAccount {
  account_key: string;
  ready: boolean;
  app_name: string;
  pinned_data: number;
  pinned_size: number;
  max_pinned_data: number;
  remaining_storage: number;
  last_used: string;
}

/** What operators and the platform identity see: the whole deployment. */
export interface DeploymentStatus extends StatusCommon {
  scope: 'deployment';
  uptime_seconds: number;
  indexer: Probe & {
    url: string;
    network: string;
    account: IndexerAccount | null;
    hosts: HostPool | null;
  };
  reconciliation: {
    status: 'ok' | 'drift' | 'failed';
    finished_at: string;
    in_sync_count: number;
    orphan_count: number;
    missing_count: number;
  } | null;
  cache: {
    hits: number;
    misses: number;
    object_bytes: number;
    object_max_bytes: number;
    object_items: number;
    manifest_items: number;
  };
}

export type SystemStatus = AccountStatus | DeploymentStatus;

interface RunTimes {
  id: string;
  started_at: string;
  finished_at: string;
  created_at: string;
  status: 'ok' | 'drift' | 'failed';
  missing_count: number;
  missing_ids: string[];
}

/** The caller's own assets in the latest run: `drift` when some of their objects are missing. */
export interface AccountReconciliation extends RunTimes {
  scope: 'account';
}

/** The whole latest run, for operators and the platform identity. */
export interface DeploymentReconciliation extends RunTimes {
  scope: 'deployment';
  db_object_count: number;
  indexer_object_count: number;
  in_sync_count: number;
  orphan_count: number;
  error_message: string | null;
  orphaned_ids: string[];
}

export type Reconciliation = AccountReconciliation | DeploymentReconciliation;

export function useAssetStats() {
  return useQuery({
    queryKey: ['stats'],
    queryFn: () => apiClient.get<AssetStats>('/stats'),
    refetchInterval: 15_000,
  });
}

export function useSystemStatus() {
  return useQuery({
    queryKey: ['system-status'],
    queryFn: () => apiClient.get<SystemStatus>('/system/status'),
    refetchInterval: 15_000,
  });
}

/** The latest reconciliation run as the caller may see it; null before any run finished. */
export function useReconciliation() {
  return useQuery({
    queryKey: ['reconciliation'],
    queryFn: async () => {
      try {
        return await apiClient.get<Reconciliation>('/reconciliation');
      } catch (err) {
        if (statusOf(err) === 404) return null;
        throw err;
      }
    },
    refetchInterval: 60_000,
  });
}

/** Queue a deployment-wide run now (operators only); false when one was already queued. */
export function useRunReconciliation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiClient.post<{ enqueued: boolean; already_pending: boolean }>(
        '/reconciliation/run',
      );
      return res.enqueued;
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['reconciliation'] }),
  });
}
