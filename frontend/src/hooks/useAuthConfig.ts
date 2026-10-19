import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

/** GET /auth/config: what a browser needs to know before anyone signs in. */
export interface AuthConfig {
  auth_disabled: boolean;
  /** No admin can sign in yet, so the setup screen is open. */
  setup_required: boolean;
  methods: { password: boolean; github: boolean };
}

export const AUTH_CONFIG_KEY = ['auth-config'];

export function fetchAuthConfig(signal?: AbortSignal): Promise<AuthConfig> {
  return apiClient.get<AuthConfig>('/auth/config', { signal });
}

/** The server's sign-in settings, for signed-in pages such as Settings. */
export function useAuthConfig() {
  return useQuery({
    queryKey: AUTH_CONFIG_KEY,
    queryFn: ({ signal }) => fetchAuthConfig(signal),
    // a server setting, which changes only with a restart
    staleTime: 5 * 60_000,
  });
}
