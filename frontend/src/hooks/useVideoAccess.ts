import { useState, useCallback } from 'react';

// ---------------------------------------------------------------------------
// Stubbed video access hook – Sia/Seal on-chain checks removed.
// Access control is now handled server-side via the backend API.
// ---------------------------------------------------------------------------

export type AccessType = 'allowlist' | null;

export interface VideoAccessState {
  hasAccess: boolean;
  accessType: AccessType;
  isChecking: boolean;
  error: string | null;
  checkAccess: (params: {
    assetId: string;
    walletAddress: string;
    accessTier: string;
  }) => Promise<boolean>;
}

export function useVideoAccess(): VideoAccessState {
  const [hasAccess, setHasAccess] = useState(false);
  const [accessType, setAccessType] = useState<AccessType>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkAccess = useCallback(
    async (_params: {
      assetId: string;
      walletAddress: string;
      accessTier: string;
    }): Promise<boolean> => {
      setIsChecking(true);
      setError(null);
      setHasAccess(false);
      setAccessType(null);

      try {
        // With the Sia backend, access control is enforced server-side.
        // For now, public content is always accessible.
        if (_params.accessTier === 'public') {
          setHasAccess(true);
          setAccessType('allowlist');
          return true;
        }

        // Non-public content: the backend handles allowlist checks.
        setHasAccess(false);
        return false;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        return false;
      } finally {
        setIsChecking(false);
      }
    },
    [],
  );

  return { hasAccess, accessType, isChecking, error, checkAccess };
}
