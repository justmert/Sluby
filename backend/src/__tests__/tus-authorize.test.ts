import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../config/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));
vi.mock('../config/env.js', () => ({
  env: { AUTH_DISABLED: false, SESSION_SECRET: 's'.repeat(40), UPLOAD_DIR: '/tmp' },
}));

import { authorizeTusRequest, type TusServerDeps } from '../upload/tus-server.js';
import { PLATFORM_ADDRESS } from '../api/ownership.js';

function deps(): TusServerDeps {
  return {
    validateApiKey: vi.fn(async (token: string) =>
      token === 'owner-key'
        ? { id: 'k1', creatorAddress: 'github:owner', scopes: ['upload'] }
        : token === 'other-key'
          ? { id: 'k2', creatorAddress: 'github:other', scopes: ['upload'] }
          : token === 'platform-key'
            ? { id: 'k3', creatorAddress: PLATFORM_ADDRESS, scopes: ['upload'] }
            : null,
    ),
    createUploadSession: vi.fn(),
    updateUploadProgress: vi.fn(),
    completeUpload: vi.fn(),
    cancelUpload: vi.fn().mockResolvedValue(undefined),
    enqueueTranscoding: vi.fn(),
    markAssetFailed: vi.fn(),
    discardAsset: vi.fn().mockResolvedValue(undefined),
    dispatchWebhook: vi.fn(),
  };
}

const upload = {
  id: 'u1',
  offset: 0,
  metadata: { creatorAddress: 'github:owner', sessionId: 's1', videoAssetId: 'a1' },
};
const getUpload = vi.fn(async (id: string) => {
  if (id !== 'u1') throw new Error('not found');
  return upload as never;
});

const req = (method: string, token?: string) =>
  new Request('http://studio.test/api/v1/uploads/u1', {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

describe('authorizeTusRequest', () => {
  let d: TusServerDeps;
  beforeEach(() => {
    d = deps();
  });

  it('rejects requests without credentials', async () => {
    await expect(authorizeTusRequest(req('PATCH'), 'u1', d, getUpload)).rejects.toMatchObject({
      status_code: 401,
    });
  });

  it('lets the owner patch their upload', async () => {
    await expect(
      authorizeTusRequest(req('PATCH', 'owner-key'), 'u1', d, getUpload),
    ).resolves.toBeUndefined();
  });

  it("hides another tenant's upload behind a 404", async () => {
    await expect(
      authorizeTusRequest(req('HEAD', 'other-key'), 'u1', d, getUpload),
    ).rejects.toMatchObject({ status_code: 404 });
    await expect(
      authorizeTusRequest(req('DELETE', 'other-key'), 'u1', d, getUpload),
    ).rejects.toMatchObject({ status_code: 404 });
    expect(d.discardAsset).not.toHaveBeenCalled();
  });

  it('lets a platform key act on any upload', async () => {
    await expect(
      authorizeTusRequest(req('HEAD', 'platform-key'), 'u1', d, getUpload),
    ).resolves.toBeUndefined();
  });

  it('cancels the session and discards the asset when the owner terminates', async () => {
    await authorizeTusRequest(req('DELETE', 'owner-key'), 'u1', d, getUpload);
    expect(d.cancelUpload).toHaveBeenCalledWith('s1');
    expect(d.discardAsset).toHaveBeenCalledWith('a1');
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
