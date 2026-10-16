// An in-process tus server that speaks the part of the Sluby upload contract
// the SDK relies on, built on the same @tus/server the backend runs (see
// backend/src/upload/tus-server.ts):
//
// - tus lives at /api/v1/uploads
// - every request except OPTIONS needs `Authorization: Bearer <key>`
// - onUploadCreate rejects non-video filetypes with 415 and stamps the new
//   asset id into the upload metadata as `videoAssetId`, which the client reads
//   back with a HEAD on the upload URL (the POST only returns Location)
//
// Everything is real: real sockets, a real FileStore in a temp dir, and the
// SDK's real tus-js-client on the other end. Clients connect through a plain
// TCP relay so a test can drop a connection part way through a request body,
// the way a flaky network does, without touching how the server reads it.

import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Server, type Upload } from '@tus/server';
import { FileStore } from '@tus/file-store';

export interface RecordedRequest {
  method: string;
  url: string;
  authorization: string | null;
  tusResumable: string | null;
  uploadOffset: number | null;
}

export interface CreatedUpload {
  uploadId: string;
  videoAssetId: string;
  size: number | undefined;
  metadata: Record<string, string | null>;
}

export interface TusContractServer {
  /** Base URL to hand to SlubyClient, e.g. http://127.0.0.1:54321 */
  baseUrl: string;
  requests: RecordedRequest[];
  created: CreatedUpload[];
  finished: string[];
  /**
   * Drop the connection carrying the next PATCH once `bytes` of the stream
   * after its request line have been relayed to the server.
   */
  cutNextPatchAfter(bytes: number): void;
  /** The bytes the store holds for an upload. */
  readUpload(uploadId: string): Promise<Buffer>;
  /** The store's view of an upload: offset, size, metadata. */
  getUpload(uploadId: string): Promise<Upload>;
  /** Data and metadata files currently in the store directory. */
  storedFiles(): Promise<string[]>;
  close(): Promise<void>;
}

export async function startTusContractServer(apiKey: string): Promise<TusContractServer> {
  const directory = await mkdtemp(path.join(tmpdir(), 'sluby-sdk-tus-'));
  const datastore = new FileStore({ directory });
  const requests: RecordedRequest[] = [];
  const created: CreatedUpload[] = [];
  const finished: string[] = [];

  const tus = new Server({
    path: '/api/v1/uploads',
    datastore,

    async onIncomingRequest(req) {
      if (req.method === 'OPTIONS') return;
      const auth = req.headers.get('authorization');
      if (!auth?.startsWith('Bearer ')) {
        throw { status_code: 401, body: 'Missing or invalid Authorization header' };
      }
      if (auth.slice(7) !== apiKey) {
        throw { status_code: 401, body: 'Invalid API key' };
      }
    },

    async onUploadCreate(_req, upload) {
      const metadata = upload.metadata ?? {};
      const fileType = metadata.filetype ?? metadata.type ?? '';
      if (fileType && !fileType.startsWith('video/')) {
        throw { status_code: 415, body: 'Only video files are accepted' };
      }
      const videoAssetId = randomUUID();
      created.push({ uploadId: upload.id, videoAssetId, size: upload.size, metadata });
      return {
        metadata: { ...metadata, sessionId: randomUUID(), videoAssetId },
      };
    },

    async onUploadFinish(_req, upload) {
      finished.push(upload.id);
      return {};
    },
  });

  const server = http.createServer((req, res) => {
    const offset = req.headers['upload-offset'];
    requests.push({
      method: req.method ?? '',
      url: req.url ?? '',
      authorization: req.headers.authorization ?? null,
      tusResumable: (req.headers['tus-resumable'] as string | undefined) ?? null,
      uploadOffset: offset === undefined ? null : Number(offset),
    });
    void tus.handle(req, res);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const upstreamPort = (server.address() as AddressInfo).port;

  let cutBudget: number | null = null;
  const sockets = new Set<net.Socket>();
  const relay = net.createServer((client) => {
    const upstream = net.connect(upstreamPort, '127.0.0.1');
    sockets.add(client).add(upstream);
    client.on('close', () => sockets.delete(client));
    upstream.on('close', () => sockets.delete(upstream));

    // remaining bytes this connection may relay before it is dropped, set
    // once the PATCH being cut shows up on it
    let allowance: number | null = null;
    client.on('data', (chunk: Buffer) => {
      if (allowance === null && cutBudget !== null) {
        const at = chunk.indexOf('PATCH ');
        if (at >= 0) {
          upstream.write(chunk.subarray(0, at));
          allowance = cutBudget;
          cutBudget = null;
          chunk = chunk.subarray(at);
        }
      }
      if (allowance === null) {
        upstream.write(chunk);
        return;
      }
      const pass = chunk.subarray(0, allowance);
      allowance -= pass.length;
      upstream.write(pass);
      if (allowance === 0) {
        client.destroy();
        upstream.end();
      }
    });
    upstream.pipe(client);
    client.on('end', () => upstream.end());
    client.on('error', () => upstream.destroy());
    upstream.on('error', () => client.destroy());
  });
  await new Promise<void>((resolve) => relay.listen(0, '127.0.0.1', resolve));
  const { port } = relay.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    created,
    finished,
    cutNextPatchAfter(bytes) {
      cutBudget = bytes;
    },
    readUpload: (uploadId) => readFile(path.join(directory, uploadId)),
    getUpload: (uploadId) => datastore.getUpload(uploadId),
    storedFiles: () => readdir(directory),
    async close() {
      for (const socket of sockets) socket.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => relay.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(directory, { recursive: true, force: true });
    },
  };
}
