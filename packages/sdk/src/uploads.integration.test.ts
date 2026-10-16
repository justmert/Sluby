// @vitest-environment node
//
// The SDK's real upload path (SlubyClient -> UploadManager -> tus-js-client)
// against a real tus server on an ephemeral port. Nothing here is mocked.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import { SlubyClient } from './client.js';
import { AuthenticationError } from './errors.js';
import { startTusContractServer, type TusContractServer } from './__tests__/tus-contract-server.js';

const API_KEY = 'sluby_integration_key';

let server: TusContractServer;
let client: SlubyClient;

beforeEach(async () => {
  server = await startTusContractServer(API_KEY);
  client = new SlubyClient({ apiKey: API_KEY, baseUrl: server.baseUrl });
});

afterEach(async () => {
  await server.close();
});

function methods(): string[] {
  return server.requests.map((r) => r.method);
}

/** Resolve once `predicate` holds, polling the event loop. */
async function until(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 5));
  }
}

describe('uploads.upload against a real tus server', () => {
  it('delivers the bytes intact with the metadata and returns the server-minted asset id', async () => {
    const file = randomBytes(300 * 1024);
    const progress: Array<[number, number, number]> = [];
    let successCalls = 0;

    const upload = client.uploads.upload(file, {
      title: 'Integration run',
      description: 'bytes over real sockets',
      accessTier: 'private',
      chunkSize: 64 * 1024,
      onProgress: (pct, sent, total) => progress.push([pct, sent, total]),
      onSuccess: () => successCalls++,
    });

    const assetId = await upload.assetId;
    await upload;

    expect(server.created).toHaveLength(1);
    const [created] = server.created;
    expect(assetId).toBe(created.videoAssetId);
    expect(created.size).toBe(file.length);
    // a Buffer has no name or type; tus sends an empty value as a bare key,
    // which the server reads back as null
    expect(created.metadata).toMatchObject({
      filename: 'video',
      filetype: null,
      title: 'Integration run',
      description: 'bytes over real sockets',
      accessTier: 'private',
    });

    expect(server.finished).toEqual([created.uploadId]);
    expect((await server.readUpload(created.uploadId)).equals(file)).toBe(true);
    expect(successCalls).toBe(1);

    // 300 KiB in 64 KiB chunks is five PATCHes, each continuing at the offset
    // the previous one ended on
    const patches = server.requests.filter((r) => r.method === 'PATCH');
    expect(patches.map((r) => r.uploadOffset)).toEqual([0, 65536, 131072, 196608, 262144]);

    expect(progress.length).toBeGreaterThan(1);
    for (let i = 1; i < progress.length; i++) {
      expect(progress[i][1]).toBeGreaterThanOrEqual(progress[i - 1][1]);
    }
    expect(progress.every(([, , total]) => total === file.length)).toBe(true);
    expect(progress[progress.length - 1]).toEqual([100, file.length, file.length]);
  });

  it('sends the bearer key on the creation POST, every PATCH, and the metadata HEAD', async () => {
    const upload = client.uploads.upload(randomBytes(4096), { title: 'auth', chunkSize: 1024 });
    await upload.assetId;
    await upload;

    const seen = new Set(methods());
    expect(seen).toEqual(new Set(['POST', 'PATCH', 'HEAD']));
    for (const req of server.requests) {
      expect(req.authorization).toBe(`Bearer ${API_KEY}`);
      expect(req.tusResumable).toBe('1.0.0');
    }
    // the asset id came from the HEAD on the upload URL the POST returned
    const head = server.requests.find((r) => r.method === 'HEAD');
    expect(head?.url).toBe(`/api/v1/uploads/${server.created[0].uploadId}`);
  });

  it('targets /api/v1/uploads when baseUrl has trailing slashes', async () => {
    const slashed = new SlubyClient({ apiKey: API_KEY, baseUrl: `${server.baseUrl}//` });
    const file = randomBytes(2048);
    const upload = slashed.uploads.upload(file, { title: 'slashes' });
    await upload;

    expect(server.requests[0]).toMatchObject({ method: 'POST', url: '/api/v1/uploads' });
    expect((await server.readUpload(server.created[0].uploadId)).equals(file)).toBe(true);
  });

  it('rejects the upload and the asset id when the server refuses the key', async () => {
    const badClient = new SlubyClient({ apiKey: 'sluby_wrong', baseUrl: server.baseUrl });
    const errors: Error[] = [];
    const upload = badClient.uploads.upload(randomBytes(1024), {
      title: 'nope',
      retryDelays: [0, 10],
      onError: (e) => errors.push(e),
    });

    const err = await upload.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AuthenticationError);
    expect((err as AuthenticationError).statusCode).toBe(401);
    expect((err as AuthenticationError).message).toBe('Invalid API key');
    expect((err as AuthenticationError).cause).toBeInstanceOf(Error);
    await expect(upload.assetId).rejects.toBe(err);
    expect(errors).toEqual([err]);
    // a 4xx is final: tus-js-client does not burn its retries on it
    expect(methods()).toEqual(['POST']);
    expect(server.created).toHaveLength(0);
  });

  it('resumes from the stored offset after a PATCH is cut off mid-body', async () => {
    const file = randomBytes(1024 * 1024);
    // the whole file goes in one PATCH; the relay drops that connection after
    // ~256 KiB of it has reached the server
    server.cutNextPatchAfter(256 * 1024);

    const upload = client.uploads.upload(file, {
      title: 'flaky',
      chunkSize: Number.POSITIVE_INFINITY,
      // long enough for the server to finish writing what it got before the
      // client asks for the offset
      retryDelays: [200, 200],
    });
    await upload;

    const [created] = server.created;
    expect((await server.readUpload(created.uploadId)).equals(file)).toBe(true);
    expect(server.finished).toEqual([created.uploadId]);

    // one upload, one cut PATCH, then a HEAD for the offset and a PATCH that
    // continues from it rather than from zero
    expect(methods().filter((m) => m === 'POST')).toHaveLength(1);
    const patches = server.requests.filter((r) => r.method === 'PATCH');
    expect(patches).toHaveLength(2);
    expect(patches[0].uploadOffset).toBe(0);
    expect(patches[1].uploadOffset).toBeGreaterThan(0);
    expect(patches[1].uploadOffset).toBeLessThan(256 * 1024);
    const between = methods().slice(methods().indexOf('PATCH') + 1, methods().lastIndexOf('PATCH'));
    expect(between).toContain('HEAD');
  });

  it('pauses mid-upload, keeps the partial upload, and resumes where it stopped', async () => {
    const file = randomBytes(512 * 1024);
    let pausedAt = -1;

    const upload = client.uploads.upload(file, {
      title: 'pausable',
      chunkSize: 32 * 1024,
      onProgress: (_pct, sent) => {
        if (pausedAt < 0 && sent >= 128 * 1024) {
          pausedAt = sent;
          void upload.pause();
        }
      },
    });

    await until(() => upload.isPaused);
    // let any in-flight request settle, then confirm nothing moves while paused
    await new Promise((r) => setTimeout(r, 100));
    const [created] = server.created;
    const stored = (await server.getUpload(created.uploadId)).offset;
    const requestsWhilePaused = server.requests.length;
    await new Promise((r) => setTimeout(r, 150));
    expect(server.requests.length).toBe(requestsWhilePaused);
    expect(stored).toBeGreaterThan(0);
    expect(stored).toBeLessThan(file.length);
    expect(server.finished).toEqual([]);

    upload.resume();
    expect(upload.isPaused).toBe(false);
    await upload;

    expect((await server.readUpload(created.uploadId)).equals(file)).toBe(true);
    expect(server.created).toHaveLength(1);
    const resumedPatch = server.requests
      .slice(requestsWhilePaused)
      .find((r) => r.method === 'PATCH');
    expect(resumedPatch?.uploadOffset).toBe(stored);
  });

  it('abort terminates the upload on the server and settles the handle', async () => {
    const file = randomBytes(512 * 1024);
    let aborting: Promise<void> | null = null;

    const upload = client.uploads.upload(file, {
      title: 'cancel me',
      chunkSize: 32 * 1024,
      onProgress: (_pct, sent) => {
        if (!aborting && sent >= 64 * 1024) aborting = upload.abort();
      },
    });

    await expect(upload).rejects.toThrow(/aborted/i);
    await aborting;

    const [created] = server.created;
    const del = server.requests.find((r) => r.method === 'DELETE');
    expect(del?.url).toBe(`/api/v1/uploads/${created.uploadId}`);
    expect(del?.authorization).toBe(`Bearer ${API_KEY}`);
    expect(server.finished).toEqual([]);
    // the store dropped the partial file and its metadata
    expect(await server.storedFiles()).toEqual([]);
    expect(upload.isPaused).toBe(false);
  });

  it('abort before the upload starts never creates one on the server', async () => {
    const upload = client.uploads.upload(randomBytes(1024), { title: 'never sent' });
    await upload.abort();

    await expect(upload).rejects.toThrow(/aborted/i);
    // give a wrongly started upload time to reach the server
    await new Promise((r) => setTimeout(r, 200));
    expect(server.requests).toEqual([]);
  });

  it('uploads a Blob in Node (as fs.openAsBlob returns) chunk by chunk', async () => {
    const bytes = randomBytes(300 * 1024);
    const upload = client.uploads.upload(new Blob([bytes], { type: 'video/mp4' }), {
      title: 'blob in node',
      chunkSize: 64 * 1024,
    });
    await upload;

    const [created] = server.created;
    expect(created.metadata.filetype).toBe('video/mp4');
    expect((await server.readUpload(created.uploadId)).equals(bytes)).toBe(true);
    expect(server.requests.filter((r) => r.method === 'PATCH')).toHaveLength(5);
  });

  it('uploads a plain Uint8Array in Node', async () => {
    const bytes = new Uint8Array(randomBytes(100 * 1024));
    const upload = client.uploads.upload(bytes, { title: 'bytes', chunkSize: 64 * 1024 });
    await upload;

    const [created] = server.created;
    expect(new Uint8Array(await server.readUpload(created.uploadId))).toEqual(bytes);
  });

  it('abort after the upload finished sends no DELETE and keeps the upload', async () => {
    const upload = client.uploads.upload(randomBytes(4096), { title: 'keep me' });
    await upload;
    const [created] = server.created;

    await upload.abort();
    await new Promise((r) => setTimeout(r, 100));

    expect(methods()).not.toContain('DELETE');
    expect(server.finished).toEqual([created.uploadId]);
    expect((await server.getUpload(created.uploadId)).offset).toBe(4096);
    await expect(upload).resolves.toBeUndefined();
  });

  it('hands out the upload id the server named the upload with', async () => {
    const upload = client.uploads.upload(randomBytes(2048), { title: 'ids' });
    const uploadId = await upload.uploadId;
    await upload;

    expect(uploadId).toBe(server.created[0].uploadId);
  });
});
