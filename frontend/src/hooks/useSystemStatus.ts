import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { SystemStatus } from './useStats';

export type { AccountStatus, DeploymentStatus, Probe, SystemStatus } from './useStats';

export const SYSTEM_STATUS_KEY = ['system-status'] as const;

/** How often a polling caller asks again. */
export const SYSTEM_STATUS_POLL_MS = 20_000;

/**
 * GET /system/status, the one query for it. Every caller shares the cache
 * entry, so the overview, the health page and the shell's health dot never
 * ask twice for the same answer.
 *
 * - `poll: true` keeps it fresh every 20 s while the tab is visible: the
 *   shell, Overview and Health, where a change has to show up on its own.
 * - without `poll` it is fetched once and then read from the cache
 *   (`staleTime: Infinity`), for pages that only need the version or the
 *   network name, such as Settings.
 */
export function useSystemStatus({ poll = false }: { poll?: boolean } = {}) {
  return useQuery({
    queryKey: SYSTEM_STATUS_KEY,
    queryFn: ({ signal }) => apiClient.get<SystemStatus>('/system/status', { signal }),
    refetchInterval: poll ? SYSTEM_STATUS_POLL_MS : false,
    // a page that polls too, opening just after the shell asked, reads the
    // same answer instead of asking again
    staleTime: poll ? SYSTEM_STATUS_POLL_MS / 2 : Infinity,
  });
}

/** The health kind for StatusBadge: the server's own verdict, or unknown before any answer. */
export type Health = SystemStatus['status'] | 'unknown';

export function healthOf(status: SystemStatus | undefined): Health {
  return status?.status ?? 'unknown';
}
