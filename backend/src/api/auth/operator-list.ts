/**
 * The syntax of OPERATOR_USERS, the accounts that saw deployment-wide
 * operations data in versions before roles. Only read now to adopt such an
 * install once: the accounts it lists become admins.
 *
 * One setting serves every sign-in provider, so each entry names its provider:
 * `<provider>:<entry>`, where `<entry>` is written exactly as in that
 * provider's sign-in allowlist (`id:<subject>`, a handle, or `*`). For GitHub:
 * `github:id:583231` or `github:octocat`. A bare `octocat` would be ambiguous
 * once a second provider exists, so it is refused at startup rather than
 * guessed. Empty means no operators.
 *
 * Kept free of the env and provider modules so env.ts can validate with it.
 */

const PROVIDER_ID = /^[a-z][a-z0-9_-]*$/;

/** The entries of each provider, in that provider's allowlist syntax. Throws on a malformed entry. */
export function parseOperatorUsers(raw: string): Map<string, string[]> {
  const byProvider = new Map<string, string[]>();
  for (const item of raw.split(',')) {
    const entry = item.trim();
    if (!entry) continue;
    const colon = entry.indexOf(':');
    const provider = colon === -1 ? '' : entry.slice(0, colon).trim().toLowerCase();
    const rest = colon === -1 ? '' : entry.slice(colon + 1).trim();
    if (!PROVIDER_ID.test(provider) || provider === 'id' || !rest) {
      throw new Error(
        `"${entry}" names no sign-in provider: write <provider>:<entry>, ` +
          'such as github:id:583231 or github:octocat',
      );
    }
    if (rest.toLowerCase().startsWith('id:') && !rest.slice(3).trim()) {
      throw new Error(`"${entry}" has an empty id`);
    }
    const list = byProvider.get(provider) ?? [];
    list.push(rest);
    byProvider.set(provider, list);
  }
  return byProvider;
}
