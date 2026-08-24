// ---------------------------------------------------------------------------
// @sluby/sdk - UploadManager
// ---------------------------------------------------------------------------

import * as tus from 'tus-js-client';
import type { AccessTier, UploadFileOptions, UploadHandle, UploadSession } from './types.js';

/** Internal fetch helper signature shared from the client. */
export type FetchFn = (path: string, init?: RequestInit) => Promise<Response>;

const DEFAULT_CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB
const DEFAULT_RETRY_DELAYS = [0, 1000, 3000, 5000];

/** Options for creating and uploading a video in one call. */
export interface UploadOptions extends UploadFileOptions {
  title: string;
  description?: string;
  accessTier?: AccessTier;
}

/**
 * The upload handle plus a promise that resolves with the created video
 * asset id (read back from the TUS creation response), so a caller can start
 * polling `assets.waitForReady` as soon as the upload begins.
 */
export type AssetUploadHandle = UploadHandle & { assetId: Promise<string> };

/**
 * Decode a base64 value from a TUS `Upload-Metadata` header, in both the
 * browser (atob) and Node (Buffer).
 */
function decodeBase64(value: string): string {
  if (typeof atob === 'function') return atob(value);
  return Buffer.from(value, 'base64').toString('utf8');
}

/** Parse a TUS `Upload-Metadata` header ("key b64val, key2 b64val2"). */
function parseUploadMetadata(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of header.split(',')) {
    const [key, b64] = pair.trim().split(' ');
    if (!key) continue;
    out[key] = b64 ? decodeBase64(b64) : '';
  }
  return out;
}

/**
 * Manages video uploads: creating and sending a file with resumable TUS
 * upload, plus status polling and cancellation.
 */
export class UploadManager {
  private readonly _fetch: FetchFn;
  private readonly _apiKey: string;
  private readonly _baseUrl: string;

  constructor(fetchFn: FetchFn, apiKey: string, baseUrl: string) {
    this._fetch = fetchFn;
    this._apiKey = apiKey;
    this._baseUrl = baseUrl;
  }

  // -----------------------------------------------------------------------
  // Resumable upload (TUS)
  // -----------------------------------------------------------------------

  /**
   * Upload a video in one step: creates the asset and streams the file to the
   * TUS endpoint with resumable support, progress reporting, and pause /
   * resume / abort control.
   *
   * The video asset is created by the server as the upload begins; read the
   * returned handle's `assetId` promise to learn its id and poll for
   * readiness. Works in the browser (File / Blob) and Node (Buffer / stream).
   *
   * @example
   * ```ts
   * const upload = client.uploads.upload(file, {
   *   title: 'My Video',
   *   onProgress: (pct) => console.log(`${pct}%`),
   * });
   * const videoAssetId = await upload.assetId;
   * await upload; // resolves when the bytes finish uploading
   * const asset = await client.assets.waitForReady(videoAssetId);
   * ```
   */
  upload(file: File | Blob | Buffer, options: UploadOptions): AssetUploadHandle {
    const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
    const retryDelays = options.retryDelays ?? DEFAULT_RETRY_DELAYS;
    // The TUS collection endpoint mints exactly one asset per upload, so a
    // single stream is required — parallelUploads would create N assets.
    const endpoint = `${this._baseUrl}/api/v1/uploads`;

    const fileName = (file as File).name ?? 'video';
    const fileType = (file as File).type ?? '';

    let paused = false;
    let headedForMetadata = false;
    let upload!: tus.Upload;

    let resolveAssetId!: (id: string) => void;
    let rejectAssetId!: (err: Error) => void;
    let assetIdSettled = false;
    const assetId = new Promise<string>((resolve, reject) => {
      resolveAssetId = (id) => {
        assetIdSettled = true;
        resolve(id);
      };
      rejectAssetId = reject;
    });

    const done = new Promise<void>((resolve, reject) => {
      upload = new tus.Upload(file as tus.Upload['file'], {
        endpoint,
        chunkSize,
        retryDelays,
        headers: { Authorization: `Bearer ${this._apiKey}` },
        metadata: {
          filename: fileName,
          filetype: fileType,
          title: options.title,
          description: options.description ?? '',
          accessTier: options.accessTier ?? 'public',
        },

        onAfterResponse: (_req, res) => {
          if (assetIdSettled) return;
          // Some servers echo Upload-Metadata directly on a response; use it.
          const header = res.getHeader('Upload-Metadata');
          if (header) {
            const id = parseUploadMetadata(header).videoAssetId;
            if (id) {
              resolveAssetId(id);
              return;
            }
          }
          // The tus creation POST only returns Location; the asset id lives in
          // the upload's metadata, which tus exposes via HEAD. Fetch it once,
          // non-blocking, so `assetId` resolves without waiting for the upload.
          const location = res.getHeader('Location');
          if (location && !headedForMetadata) {
            headedForMetadata = true;
            fetch(location, {
              method: 'HEAD',
              headers: { Authorization: `Bearer ${this._apiKey}`, 'Tus-Resumable': '1.0.0' },
            })
              .then((r) => {
                const meta = r.headers.get('Upload-Metadata');
                if (meta) {
                  const id = parseUploadMetadata(meta).videoAssetId;
                  if (id) resolveAssetId(id);
                }
              })
              .catch(() => {
                /* leave assetId pending; the caller can still poll assets.list */
              });
          }
        },

        onProgress: (bytesUploaded: number, bytesTotal: number) => {
          if (options.onProgress && bytesTotal > 0) {
            const percent = Math.round((bytesUploaded / bytesTotal) * 100);
            options.onProgress(percent, bytesUploaded, bytesTotal);
          }
        },

        onSuccess: () => {
          options.onSuccess?.();
          resolve();
        },

        onError: (error: Error) => {
          if (!assetIdSettled) rejectAssetId(error);
          options.onError?.(error);
          reject(error);
        },
      });

      upload.findPreviousUploads().then((previousUploads) => {
        if (paused) return;
        if (previousUploads.length > 0) {
          upload.resumeFromPreviousUpload(previousUploads[0]);
        }
        upload.start();
      });
    });

    // Avoid an unhandled rejection on assetId if the caller only awaits done.
    assetId.catch(() => {});

    const handle = done as AssetUploadHandle;
    handle.assetId = assetId;
    handle.pause = async () => {
      paused = true;
      await upload.abort(false);
    };
    handle.resume = () => {
      if (!paused) return;
      paused = false;
      upload.start();
    };
    handle.abort = async () => {
      paused = false;
      await upload.abort(true);
    };
    Object.defineProperty(handle, 'isPaused', {
      get: () => paused,
      enumerable: true,
    });

    return handle;
  }

  // -----------------------------------------------------------------------
  // GET /api/v1/uploads/:id
  // -----------------------------------------------------------------------

  /**
   * Retrieve the current status and progress of an upload session.
   */
  async getStatus(uploadId: string): Promise<UploadSession> {
    const res = await this._fetch(`/api/v1/uploads/${encodeURIComponent(uploadId)}`);
    const body = await res.json();

    return {
      id: body.id,
      videoAssetId: body.video_asset_id,
      status: body.status,
      progressPercent: body.progress_percent,
      fileSize: body.file_size,
      uploadedBytes: body.uploaded_bytes,
    };
  }

  // -----------------------------------------------------------------------
  // DELETE /api/v1/uploads/:id
  // -----------------------------------------------------------------------

  /**
   * Cancel an in-progress upload and clean up server-side resources.
   */
  async cancel(uploadId: string): Promise<void> {
    await this._fetch(`/api/v1/uploads/${encodeURIComponent(uploadId)}`, {
      method: 'DELETE',
    });
  }
}
