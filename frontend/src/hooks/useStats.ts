import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

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
  error?: string;
}

export interface SystemStatus {
  status: 'ok' | 'degraded' | 'down';
  checked_at: string;
  version: string;
  uptime_seconds: number;
  database: Probe;
  redis: Probe;
  indexer: Probe & {
    url: string;
    network: string;
    account: {
      account_key: string;
      ready: boolean;
      app_name: string;
      pinned_data: number;
      pinned_size: number;
      max_pinned_data: number;
      remaining_storage: number;
      last_used: string;
    } | null;
    hosts: { total: number; good_for_upload: number; countries: number } | null;
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
