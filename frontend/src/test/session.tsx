import type { ReactNode } from 'react';
import { SessionContext, type AuthSession } from '@/lib/session';

export const testSession: AuthSession = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Alice',
  username: 'alice',
  provider: 'github',
  providerLabel: 'GitHub',
  authDisabled: false,
  role: 'member',
  admin: false,
  signIn: [{ provider: 'github', username: 'alice' }],
  expiresAt: '2026-10-14T00:00:00.000Z',
};

/**
 * Render `children` as signed in, the way the AuthGate does. `admin` also
 * sets the role, so `<WithSession admin>` is an admin session.
 */
export function WithSession({
  children,
  ...overrides
}: Partial<AuthSession> & { children: ReactNode }) {
  const role = overrides.role ?? (overrides.admin ? 'admin' : testSession.role);
  return (
    <SessionContext.Provider
      value={{ ...testSession, ...overrides, role, admin: role === 'admin' }}
    >
      {children}
    </SessionContext.Provider>
  );
}
