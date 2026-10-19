import { env } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';
import { SignInError, type ProviderProfile, type SignInProvider } from './types.js';

/**
 * Sign-in with a GitHub OAuth app. Everything GitHub specific lives here: the
 * endpoints, GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET, and the numeric
 * account id as the stable subject. It only signs members in; who is a member
 * is decided by the workspace, not by GitHub.
 */

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';

// a hung github must not hold the callback (and the browser) forever
const GITHUB_TIMEOUT_MS = 10_000;

// github logins are case-insensitive
const normalizeLogin = (login: string) => login.trim().toLowerCase();

interface TokenResponse {
  access_token?: string;
  error?: string;
}

interface GithubUser {
  id?: unknown;
  login?: unknown;
  name?: unknown;
}

const failed = () => new SignInError('failed', 'GitHub sign-in failed. Please try again.');

async function exchangeCode(code: string, callbackUrl: string): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: callbackUrl,
    }),
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || body.error || !body.access_token) {
    logger.warn({ status: res.status, error: body.error }, 'GitHub token exchange failed');
    throw failed();
  }
  return body.access_token;
}

async function fetchUser(accessToken: string): Promise<ProviderProfile> {
  const res = await fetch(USER_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${accessToken}`,
      'User-Agent': 'sluby',
    },
    signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
  });
  if (!res.ok) {
    logger.warn({ status: res.status }, 'GitHub /user call failed');
    throw failed();
  }
  const user = (await res.json()) as GithubUser;
  // the numeric id is the account; the login can be renamed and then
  // registered by someone else
  if (typeof user.id !== 'number' || !Number.isSafeInteger(user.id) || user.id <= 0) {
    logger.warn('GitHub /user answered without a numeric id');
    throw failed();
  }
  if (typeof user.login !== 'string' || user.login === '') {
    logger.warn('GitHub /user answered without a login');
    throw failed();
  }
  const name = typeof user.name === 'string' && user.name.trim() ? user.name.trim() : user.login;
  return { subject: String(user.id), username: user.login, displayName: name };
}

export const githubProvider: SignInProvider = {
  id: 'github',
  label: 'GitHub',

  isConfigured: () => Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),

  authorizationUrl({ state, callbackUrl }) {
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('client_id', env.GITHUB_CLIENT_ID ?? '');
    url.searchParams.set('redirect_uri', callbackUrl);
    url.searchParams.set('scope', 'read:user');
    url.searchParams.set('state', state);
    return url.toString();
  },

  async completeSignIn(query, { callbackUrl }) {
    if (query.error !== undefined) {
      // logged as given, never echoed to the browser
      logger.warn({ error: String(query.error).slice(0, 200) }, 'GitHub sign-in returned an error');
      if (query.error === 'access_denied') {
        throw new SignInError('cancelled', 'GitHub sign-in was cancelled.');
      }
      throw failed();
    }
    const code = typeof query.code === 'string' ? query.code : '';
    if (!code) throw new SignInError('invalid', 'GitHub did not send a sign-in code.');
    const token = await exchangeCode(code, callbackUrl);
    return fetchUser(token);
  },

  normalizeHandle: normalizeLogin,
};
