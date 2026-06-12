import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AllowlistResponse {
  id: string;
  name: string;
  video_id: string;
  allowed: string[];
  created_at?: string;
}

export interface CreateAllowlistParams {
  video_asset_id: string;
  name: string;
  initial_addresses?: string[];
}

export interface AddAllowlistMemberParams {
  allowlistId: string;
  address: string;
}

export interface SubscriptionResponse {
  id: string;
  subscriber: string;
  creator?: string;
  expires_at: string;
  tier: number;
  created_at?: string;
}

export interface PurchaseSubscriptionParams {
  subscriber_address: string;
  duration_days: number;
  tier?: number;
}

export interface TicketResponse {
  id: string;
  viewer: string;
  video_id: string;
  created_at?: string;
}

export interface PurchaseTicketParams {
  viewer_address: string;
  video_asset_id: string;
}

// ---------------------------------------------------------------------------
// Query Hooks
// ---------------------------------------------------------------------------

export function useAllowlists(): UseQueryResult<AllowlistResponse[]> {
  return useQuery({
    queryKey: ['allowlists'],
    queryFn: () => apiClient.get<AllowlistResponse[]>('/access-control/allowlists'),
  });
}

export function useSubscriptions(): UseQueryResult<SubscriptionResponse[]> {
  return useQuery({
    queryKey: ['subscriptions'],
    queryFn: () => apiClient.get<SubscriptionResponse[]>('/access-control/subscriptions'),
  });
}

export function useViewingTickets(): UseQueryResult<TicketResponse[]> {
  return useQuery({
    queryKey: ['tickets'],
    queryFn: () => apiClient.get<TicketResponse[]>('/access-control/tickets'),
  });
}

// ---------------------------------------------------------------------------
// Mutation Hooks
// ---------------------------------------------------------------------------

export function useCreateAllowlist(): UseMutationResult<
  AllowlistResponse,
  Error,
  CreateAllowlistParams
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params) =>
      apiClient.post<AllowlistResponse>('/access-control/allowlists', params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allowlists'] });
    },
  });
}

export function useAddAllowlistMember(): UseMutationResult<
  { success: boolean },
  Error,
  AddAllowlistMemberParams
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ allowlistId, address }) =>
      apiClient.post<{ success: boolean }>(
        `/access-control/allowlists/${allowlistId}/members`,
        { address },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allowlists'] });
    },
  });
}

export function useDeleteAllowlist(): UseMutationResult<
  { success: boolean },
  Error,
  string
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id) =>
      apiClient.delete<{ success: boolean }>(`/access-control/allowlists/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allowlists'] });
    },
  });
}

export function useRemoveAllowlistMember(): UseMutationResult<
  { success: boolean },
  Error,
  { allowlistId: string; address: string }
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ allowlistId, address }) =>
      apiClient.delete<{ success: boolean }>(
        `/access-control/allowlists/${allowlistId}/members/${encodeURIComponent(address)}`,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['allowlists'] });
    },
  });
}

export function usePurchaseSubscription(): UseMutationResult<
  SubscriptionResponse,
  Error,
  PurchaseSubscriptionParams
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params) =>
      apiClient.post<SubscriptionResponse>(
        '/access-control/subscriptions',
        params,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
    },
  });
}

export function usePurchaseTicket(): UseMutationResult<
  TicketResponse,
  Error,
  PurchaseTicketParams
> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params) =>
      apiClient.post<TicketResponse>('/access-control/tickets', params),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
    },
  });
}
