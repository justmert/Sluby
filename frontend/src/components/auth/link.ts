/** An invite or reset link the studio was opened at, from its path. */
export interface LinkPath {
  kind: 'join' | 'reset';
  token: string;
}

// tokens are 32 random bytes in base64url (backend link-token.ts)
const LINK_PATH = /^\/studio\/(join|reset)\/([A-Za-z0-9_-]+)\/?$/;

/** The link in `pathname`, or null on any other page. These pages need no session. */
export function linkFromPath(pathname: string): LinkPath | null {
  const match = LINK_PATH.exec(pathname);
  if (!match) return null;
  return { kind: match[1] as LinkPath['kind'], token: match[2] };
}

/** GET /auth/invites/:token */
export type LinkInfo =
  | { kind: 'invite'; role: 'admin' | 'member'; expires_at: string; github: boolean }
  | { kind: 'reset'; email: string | null; expires_at: string; github: boolean };
