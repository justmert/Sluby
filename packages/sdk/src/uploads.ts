// ---------------------------------------------------------------------------
// @sluby/sdk - UploadManager
// ---------------------------------------------------------------------------

import * as tus from 'tus-js-client';
import type {
  CreateUploadOptions,
  CreateUploadResult,
  UploadFileOptions,
  UploadSession,
} from './types.js';

/** Internal fetch helper signature shared from the client. */
export type FetchFn = (
  path: string,
  init?: RequestInit,
) => Promise<Response>;

const DEFAULT_CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB
const DEFAULT_PARALLEL_UPLOADS = 3;
const DEFAULT_RETRY_DELAYS = [0, 1000, 3000, 5000];

/**
 * Manages video upload creation, TUS file upload, status polling, and
 * cancellation.
 */
export class UploadManager {
  private readonly _fetch: FetchFn;
  private readonly _apiKey: string;

  constructor(fetchFn: FetchFn, apiKey: string) {
    this._fetch = fetchFn;
    this._apiKey = apiKey;
  }

  // -----------------------------------------------------------------------
  // POST /api/v1/uploads
  // -----------------------------------------------------------------------

  /**
   * Create a new upload session on the backend.
   *
   * Returns the TUS upload URL and the video asset ID.
   */
  async create(options: CreateUploadOptions): Promise<CreateUploadResult> {
    const res = await this._fetch('/api/v1/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: options.title,
        description: options.description,
        access_tier: options.accessTier,
      }),
    });

    const body = await res.json();

    return {
      videoAssetId: body.video_asset_id,
      uploadUrl: body.upload_url,
    };
  }

  // -----------------------------------------------------------------------
  // TUS resumable upload
  // -----------------------------------------------------------------------

  /**
   * Upload a file to the provided TUS endpoint with resumable upload
   * support, progress reporting, and configurable retry behaviour.
   *
   * Works in both browser (File / Blob) and Node.js (Buffer) environments.
   */
  uploadFile(
    uploadUrl: string,
    file: File | Blob | Buffer,
    options?: UploadFileOptions,
  ): Promise<void> {
    const chunkSize = options?.chunkSize ?? DEFAULT_CHUNK_SIZE;
    const parallelUploads = options?.parallelUploads ?? DEFAULT_PARALLEL_UPLOADS;
    const retryDelays = options?.retryDelays ?? DEFAULT_RETRY_DELAYS;

    return new Promise<void>((resolve, reject) => {
      const upload = new tus.Upload(file as tus.Upload['file'], {
        endpoint: uploadUrl,
        chunkSize,
        parallelUploads,
        retryDelays,
        headers: {
          Authorization: `Bearer ${this._apiKey}`,
        },
        metadata: {},

        onProgress: (bytesUploaded: number, bytesTotal: number) => {
          if (options?.onProgress && bytesTotal > 0) {
            const percent = Math.round((bytesUploaded / bytesTotal) * 100);
            options.onProgress(percent);
          }
        },

        onSuccess: () => {
          resolve();
        },

        onError: (error: Error) => {
          if (options?.onError) {
            options.onError(error);
          }
          reject(error);
        },
      });

      // Check for a previous incomplete upload that can be resumed.
      upload.findPreviousUploads().then((previousUploads) => {
        if (previousUploads.length > 0) {
          upload.resumeFromPreviousUpload(previousUploads[0]);
        }
        upload.start();
      });
    });
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
      uploadUrl: body.upload_url,
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
