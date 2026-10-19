import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../config/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));
vi.mock('../config/env.js', () => ({
  env: {
    AUTH_DISABLED: false,
    SESSION_SECRET: 's'.repeat(40),
    UPLOAD_DIR: '/tmp',
  },
}));

import { authorizeTusRequest, type TusServerDeps } from '../upload/tus-server.js';
import { SESSION_COOKIE_NAME, signSession } from '../api/auth/session.js';
import { env } from '../config/env.js';
import { memoryAccounts } from './helpers/accounts.js';

let accounts: ReturnType<typeof memoryAccounts>;
let owner: { userId: string; id: string };
let liveSid: string;
let revokedSid: string;

function deps(): TusServerDeps {
  return {
    callers: accounts.callerDeps,
    createUploadSession: vi.fn(),
    updateUploadProgress: vi.fn(),
    markUploading: vi.fn(),
    completeUpload: vi.fn(),
    cancelUpload: vi.fn().mockResolvedValue(undefined),
    abandonUpload: vi.fn(),
    enqueueTranscoding: vi.fn(),
    markAssetFailed: vi.fn(),
    discardAsset: vi.fn().mockResolvedValue(undefined),
    dispatchWebhook: vi.fn(),
  };
}

let upload: { id: string; offset: number; metadata: Record<string, string> };
const getUpload = vi.fn(async (id: string) => {
  if (id !== 'u1') throw new Error('not found');
  return upload as never;
});

const req = (method: string, token?: string) =>
  new Request('http://studio.test/api/v1/uploads/u1', {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

const sessionReq = (method: string, sid: string) =>
  new Request('http://studio.test/api/v1/uploads/u1', {
    method,
    headers: {
      cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(signSession(sid, owner.userId, env.SESSION_SECRET))}`,
    },
  });

beforeEach(async () => {
  env.AUTH_DISABLED = false;
  accounts = memoryAccounts();
  owner = accounts.addAccount('github', '1', 'owner');
  const other = accounts.addAccount('github', '2', 'other');
  const session = (expired: boolean) =>
    accounts.authDeps.createSession({
      userId: owner.userId,
      identityId: owner.id,
      expiresAt: new Date(Date.now() + (expired ? -1 : 3600_000)),
      userAgent: null,
    });
  liveSid = (await session(false)).id;
  revokedSid = (await session(true)).id;
  accounts.addKey('owner-key', { createdBy: owner.userId, scopes: ['upload'] });
  accounts.addKey('other-key', { createdBy: other.userId, scopes: ['upload'] });
  accounts.addKey('seed-key', { scopes: ['upload'] });
  accounts.addKey('read-key', { createdBy: owner.userId, scopes: ['read'] });
  upload = {
    id: 'u1',
    offset: 0,
    metadata: { creatorAddress: 'workspace', sessionId: 's1', videoAssetId: 'a1' },
  };
});

afterEach(() => {
  env.AUTH_DISABLED = false;
});

describe('authorizeTusRequest', () => {
  let d: TusServerDeps;
  beforeEach(() => {
    d = deps();
  });

  it('lets a live studio session patch its own upload', async () => {
    await expect(
      authorizeTusRequest(sessionReq('PATCH', liveSid), 'u1', d, getUpload),
    ).resolves.toBeUndefined();
  });

  it('rejects a signed session cookie whose session is no longer live', async () => {
    await expect(
      authorizeTusRequest(sessionReq('PATCH', revokedSid), 'u1', d, getUpload),
    ).rejects.toMatchObject({ status_code: 401 });
  });

  it('rejects requests without credentials', async () => {
    await expect(authorizeTusRequest(req('PATCH'), 'u1', d, getUpload)).rejects.toMatchObject({
      status_code: 401,
    });
  });

  it('rejects a key without upload scope', async () => {
    await expect(
      authorizeTusRequest(req('PATCH', 'read-key'), 'u1', d, getUpload),
    ).rejects.toMatchObject({ status_code: 403 });
  });

  it('lets a member patch their own upload', async () => {
    await expect(
      authorizeTusRequest(req('PATCH', 'owner-key'), 'u1', d, getUpload),
    ).resolves.toBeUndefined();
  });

  it('refuses the key of a removed member', async () => {
    accounts.disable(owner.userId);
    await expect(
      authorizeTusRequest(req('PATCH', 'owner-key'), 'u1', d, getUpload),
    ).rejects.toMatchObject({ status_code: 401 });
  });

  it('lets any member with the upload scope resume or cancel an upload another member began', async () => {
    for (const key of ['other-key', 'seed-key']) {
      await expect(
        authorizeTusRequest(req('HEAD', key), 'u1', d, getUpload),
      ).resolves.toBeUndefined();
    }
    await authorizeTusRequest(req('DELETE', 'other-key'), 'u1', d, getUpload);
    expect(d.discardAsset).toHaveBeenCalledWith('a1');
  });

  it('lets an upload-scoped caller resume an upload begun under a per-account owner before the upgrade', async () => {
    upload.metadata.creatorAddress = 'user:00000000-0000-4000-8000-0000000000aa';
    await expect(
      authorizeTusRequest(req('PATCH', 'other-key'), 'u1', d, getUpload),
    ).resolves.toBeUndefined();
    upload.metadata.creatorAddress = 'github:someone';
    await expect(
      authorizeTusRequest(req('PATCH', 'owner-key'), 'u1', d, getUpload),
    ).resolves.toBeUndefined();
  });

  it('runs as the local dev account under AUTH_DISABLED even with a session cookie, like the api', async () => {
    env.AUTH_DISABLED = true;
    // a removed account's cookie would be refused, but under AUTH_DISABLED
    // nobody signs in: every request is the dev account
    accounts.disable(owner.userId);
    await expect(
      authorizeTusRequest(sessionReq('PATCH', liveSid), 'u1', d, getUpload),
    ).resolves.toBeUndefined();
  });

  it('cancels the session and discards the asset when the owner terminates', async () => {
    await authorizeTusRequest(req('DELETE', 'owner-key'), 'u1', d, getUpload);
    expect(d.cancelUpload).toHaveBeenCalledWith('s1');
    expect(d.discardAsset).toHaveBeenCalledWith('a1');
  });

  it('leaves a finished upload and its asset alone, for tus to refuse the termination', async () => {
    const finished = vi.fn(async () => ({ ...upload, size: 10, offset: 10 }) as never);
    await expect(
      authorizeTusRequest(req('DELETE', 'owner-key'), 'u1', d, finished),
    ).resolves.toBeUndefined();
    expect(d.cancelUpload).not.toHaveBeenCalled();
    expect(d.discardAsset).not.toHaveBeenCalled();
  });

  it('leaves unknown upload ids to the tus handler', async () => {
    await expect(
      authorizeTusRequest(req('DELETE', 'owner-key'), 'missing', d, getUpload),
    ).resolves.toBeUndefined();
    expect(d.discardAsset).not.toHaveBeenCalled();
  });

  it('skips the ownership lookup on creation', async () => {
    getUpload.mockClear();
    await authorizeTusRequest(req('POST', 'owner-key'), '', d, getUpload);
    expect(getUpload).not.toHaveBeenCalled();
  });
});
