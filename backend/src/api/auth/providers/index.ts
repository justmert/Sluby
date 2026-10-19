import { githubProvider } from './github.js';
import type { SignInProvider } from './types.js';

export type { SignInProvider, ProviderProfile } from './types.js';
export { SignInError } from './types.js';

/** Every sign-in provider this build knows. A new one is added here. */
export const SIGN_IN_PROVIDERS: readonly SignInProvider[] = [githubProvider];

export function getProvider(id: string): SignInProvider | undefined {
  return SIGN_IN_PROVIDERS.find((p) => p.id === id);
}

/**
 * The provider of the account AUTH_DISABLED runs as. It is not a way to sign
 * in, only the identity of the local dev account.
 */
export const LOCAL_PROVIDER = 'local';
export const LOCAL_DEV_SUBJECT = 'dev';
