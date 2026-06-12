import { useMemo } from 'react';
import { apiClient } from '../lib/api-client';

/**
 * Provides the shared API client instance.
 * Exists mostly as a seam for testing / context overrides in the future.
 */
export function useApiClient() {
  return useMemo(() => apiClient, []);
}
