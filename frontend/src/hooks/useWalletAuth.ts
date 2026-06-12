import { useMemo } from 'react';

// ---------------------------------------------------------------------------
// Stubbed wallet auth – Sia/dApp-kit dependency removed.
// The hook is kept to avoid breaking existing imports but always reports
// "not connected".  A Sia-native auth flow can replace this in the future.
// ---------------------------------------------------------------------------

export interface WalletAuth {
  isConnected: boolean;
  address: string | null;
  disconnect: () => void;
  signMessage: (message: Uint8Array) => Promise<{ signature: string }>;
}

export function useWalletAuth(): WalletAuth {
  return useMemo(
    () => ({
      isConnected: false,
      address: null,
      disconnect: () => {},
      signMessage: async () => ({ signature: '' }),
    }),
    [],
  );
}
