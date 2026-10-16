import { SIGN_IN_PROVIDERS, type SignInProvider } from './providers/index.js';

/**
 * Sign-in settings worth a warning at startup, so an open Studio or a session
 * cookie that can travel in plaintext is never a silent surprise.
 */
export function signInWarnings(
  opts: { authDisabled: boolean; publicUrl: string },
  providers: readonly SignInProvider[] = SIGN_IN_PROVIDERS,
): string[] {
  if (opts.authDisabled) return [];
  const warnings: string[] = [];

  for (const provider of providers) {
    if (!provider.isConfigured()) continue;
    const allowlist = provider.allowlist();
    if (allowlist.open && !allowlist.explicitlyOpen) {
      warnings.push(
        `${provider.label} sign-in has no allowlist: any ${provider.label} account can sign in ` +
          'and gets its own tenant. List who may sign in, or set it to "*" to keep sign-up open on purpose.',
      );
    }
  }

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
