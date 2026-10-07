import type { ReactNode } from 'react';
import { SessionContext, type AuthSession } from '@/lib/session';

export const testSession: AuthSession = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Alice',
  username: 'alice',
  provider: 'github',
  providerLabel: 'GitHub',
  authDisabled: false,
  operator: false,
  expiresAt: '2026-10-14T00:00:00.000Z',
};

/** Render `children` as signed in, the way the AuthGate does. */
export function WithSession({
  children,
  ...overrides
}: Partial<AuthSession> & { children: ReactNode }) {
  return (
    <SessionContext.Provider value={{ ...testSession, ...overrides }}>
      {children}
    </SessionContext.Provider>
  );
}
