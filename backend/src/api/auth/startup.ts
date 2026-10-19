/**
 * Sign-in settings worth a warning at startup, so a session cookie that can
 * travel in plaintext is never a silent surprise.
 */
export function signInWarnings(opts: { authDisabled: boolean; publicUrl: string }): string[] {
  if (opts.authDisabled) return [];
  const warnings: string[] = [];

  // the session cookie is only marked Secure for an https public url;
  // browsers treat localhost as a secure context anyway, other hosts do not
  const url = new URL(opts.publicUrl);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol === 'http:' && !loopback) {
    warnings.push(
      `PUBLIC_URL is http on ${url.hostname}: Studio session cookies are sent without TLS ` +
        'and are not marked Secure. Serve the Studio over https.',
    );
  }
  return warnings;
}

/**
 * The old access settings that are still set once their values were adopted
 * (see adopt-legacy.ts). Members and roles live in the database now, so an
 * operator editing these would expect an effect that never comes.
 */
export function ignoredSettingWarnings(opts: {
  githubAllowedUsers: string;
  operatorUsers: string;
}): string[] {
  const warnings: string[] = [];
  if (opts.githubAllowedUsers.trim()) {
    warnings.push(
      'GITHUB_ALLOWED_USERS is set but ignored: it was read once when this install moved to ' +
        'members. Invite people and remove members on the Members page, then remove the setting.',
    );
  }
  if (opts.operatorUsers.trim()) {
    warnings.push(
      'OPERATOR_USERS is set but ignored: it was read once when this install moved to roles. ' +
        'Change roles on the Members page, then remove the setting.',
    );
  }
  return warnings;
}

/**
 * The startup line that lets whoever runs the server claim a fresh install:
 * where the setup screen is and the code it asks for (see setup-code.ts).
 * Only logged while no admin can sign in, so the code is useless by the time
 * anyone else reads old logs.
 */
export function setupCodeNotice(opts: { publicUrl: string; code: string }): string {
  const studio = `${opts.publicUrl.replace(/\/+$/, '')}/studio`;
  return (
    `No admin can sign in yet. Open ${studio} and set up the first admin with the setup ` +
    `code ${opts.code}.`
  );
}
