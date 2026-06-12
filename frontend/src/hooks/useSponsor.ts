import { useMutation, type UseMutationResult } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';

// ---------------------------------------------------------------------------
// Types – Seal/Sia sponsorship removed; kept as simple transaction sponsor.
// ---------------------------------------------------------------------------

export interface SponsorResult {
  tx_bytes: string;
  sponsor_signature: string;
}

export interface SponsorTransactionParams {
  txBytes: string;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export function useSponsorTransaction(): UseMutationResult<
  SponsorResult,
  Error,
  SponsorTransactionParams
> {
  return useMutation({
    mutationFn: (params) =>
      apiClient.post<SponsorResult>('/sponsor/transaction', params),
  });
}
