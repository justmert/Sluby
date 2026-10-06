// ---------------------------------------------------------------------------
// @sluby/sdk - UploadManager
// ---------------------------------------------------------------------------

import * as tus from 'tus-js-client';
import {
  AbortError,
  SlubyError,
  errorFromStatus,
  extractErrorMessage,
  readJson,
} from './errors.js';
import type {
  AccessTier,
  RequestOptions,
  UploadFileOptions,
  UploadHandle,
  UploadSession,
  UploadSessionStatus,
} from './types.js';

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
 * The upload handle plus promises for the ids the server assigns as the
 * upload starts, so a caller can poll `assets.waitForReady` or
 * `uploads.getStatus` before the bytes finish.
 */
export type AssetUploadHandle = UploadHandle & {
  /** The video asset the upload creates, read back from the tus upload's metadata. */
  assetId: Promise<string>;
  /** The upload's id (the last segment of its tus URL), as `uploads.getStatus` and `uploads.cancel` take it. */
  uploadId: Promise<string>;
};

/** What `upload()` accepts: a File or Blob, or the raw bytes (a Node Buffer is a Uint8Array). */
export type UploadInput = Blob | Uint8Array;

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

/** The upload id in a tus upload URL: its last path segment. */
function uploadIdFromUrl(url: string): string {
  const path = url.split(/[?#]/)[0].replace(/\/+$/, '');
  return decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
}

function isBlob(value: unknown): value is Blob {
  return typeof Blob !== 'undefined' && value instanceof Blob;
}

// cyrb53: a fast 53-bit string hash. Only used to tell fingerprints apart, so
// the key and metadata never sit in localStorage in the clear.
function hash53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/**
 * Reads the inputs tus-js-client's own readers refuse, in chunks of the tus
 * chunk size, and hands everything else to them: a Uint8Array that is not a
 * Node Buffer (the browser reader needs a Blob, the Node reader a Buffer), and
 * a Blob where there is no XMLHttpRequest to send one (Node, which has Blob
 * and `fs.openAsBlob` but whose tus build only takes Buffers and streams).
 */
const fileReader: tus.UploadOptions['fileReader'] = {
  async openFile(input: unknown, chunkSize: number) {
    if (input instanceof Uint8Array) {
      const bytes = input;
      return {
        size: bytes.byteLength,
        async slice(start: number, end: number) {
          return chunk(
            bytes.subarray(start, Math.min(end, bytes.byteLength)),
            end,
            bytes.byteLength,
          );
        },
        close() {},
      };
    }
    if (isBlob(input) && typeof XMLHttpRequest === 'undefined') {
      const blob = input;
      return {
        size: blob.size,
        async slice(start: number, end: number) {
          const part = new Uint8Array(await blob.slice(start, end).arrayBuffer());
          return chunk(part, end, blob.size);
        },
        close() {},
      };
    }
    return tus.defaultOptions.fileReader.openFile(input, chunkSize);
  },
};

// tus reads `value.size` for the Content-Length of a chunk body
function chunk(value: Uint8Array, end: number, size: number) {
  return { value: Object.assign(value, { size: value.byteLength }), done: end >= size };
}

/** Turn whatever tus-js-client rejected with into a typed `SlubyError`. */
function uploadError(err: unknown): SlubyError {
  if (err instanceof SlubyError) return err;
  const detailed = err as { originalResponse?: tus.HttpResponse | null; message?: string };
  const response = detailed?.originalResponse;
  if (response) {
    const status = response.getStatus();
    let body: string | undefined;
    try {
      body = response.getBody() || undefined;
    } catch {
      // some stacks cannot read the body of a failed response; the status is enough
    }
    const typed = errorFromStatus(
      status,
      extractErrorMessage(body, `Upload request failed with status ${status}`),
      body,
      response.getHeader('Retry-After'),
    );
    (typed as { cause?: unknown }).cause = err;
    return typed;
  }
  const message = err instanceof Error ? err.message : String(err);
  return new SlubyError(`Upload failed: ${message}`, 0, undefined, { cause: err });
}

/** How uploads authenticate: an API key, or the browser's cookie session. */
export interface UploadAuth {
  apiKey?: string;
  baseUrl: string;
  credentials?: RequestCredentials;
}

/**
 * Manages video uploads: creating and sending a file with resumable TUS
 * upload, plus status polling and cancellation.
 */
export class UploadManager {
  private readonly _fetch: FetchFn;
  private readonly _apiKey: string | undefined;
  private readonly _baseUrl: string;
  private readonly _credentials: RequestCredentials | undefined;

  constructor(fetchFn: FetchFn, auth: UploadAuth) {
    this._fetch = fetchFn;
    this._apiKey = auth.apiKey;
    this._baseUrl = auth.baseUrl;
    this._credentials = auth.credentials;
  }

  private _authHeaders(): Record<string, string> {
    return this._apiKey ? { Authorization: `Bearer ${this._apiKey}` } : {};
  }

  /**
   * Whether a stored upload URL is an upload the server still holds and has
   * not received in full. A finished upload must not be resumed: tus would
   * report success without sending anything and the new metadata would be
   * dropped, so the caller would get the old asset (possibly deleted).
   * Anything uncertain counts as "do not resume": a new upload never loses
   * data, a wrong resume does.
   */
  private async _isUnfinished(uploadUrl: string | null): Promise<'resume' | 'stale' | 'unknown'> {
    if (!uploadUrl) return 'stale';
    let res: Response;
    try {
      res = await fetch(uploadUrl, {
        method: 'HEAD',
        headers: { ...this._authHeaders(), 'Tus-Resumable': '1.0.0' },
        ...(this._credentials ? { credentials: this._credentials } : {}),
      });
    } catch {
      return 'unknown';
    }
    if (!res.ok) return res.status >= 400 && res.status < 500 ? 'stale' : 'unknown';
    const offset = Number(res.headers.get('Upload-Offset'));
    const length = Number(res.headers.get('Upload-Length'));
    if (!Number.isFinite(offset) || !Number.isFinite(length)) return 'unknown';
    return offset < length ? 'resume' : 'stale';
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
   * readiness. Takes a File or Blob in the browser, and a Buffer, Uint8Array
   * or Blob (for example from `fs.openAsBlob`) in Node. Node streams are not
   * accepted.
   *
   * Each call creates a new asset. In the browser an unfinished upload of the
   * same file with the same title, description, tier and key, interrupted on
   * an earlier page load, is resumed instead (turn that off with
   * `resume: false`); a finished one never is.
   *
   * The handle and `assetId` reject with a `SlubyError` (an
   * `AuthenticationError`, `PermissionError` and so on for an HTTP status,
   * with the tus error as `cause`), or an `AbortError` after `abort()`.
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
  upload(file: UploadInput, options: UploadOptions): AssetUploadHandle {
    const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
    const retryDelays = options.retryDelays ?? DEFAULT_RETRY_DELAYS;
    const resumeEnabled = options.resume ?? true;
    // The TUS collection endpoint mints exactly one asset per upload, so a
    // single stream is required: parallelUploads would create N assets.
    const endpoint = `${this._baseUrl}/api/v1/uploads`;

    const fileName = isBlob(file) && 'name' in file ? (file as File).name : 'video';
    const fileType = isBlob(file) ? file.type : '';

    const withCredentials = this._credentials === 'include';
    const metadata = {
      filename: fileName || 'video',
      filetype: fileType,
      title: options.title,
      description: options.description ?? '',
      accessTier: options.accessTier ?? 'public',
    };
    // ties a stored upload to this key and this metadata, so another key or
    // another title for the same file starts a new upload
    const identity = hash53(`${this._apiKey ?? 'session'}\n${JSON.stringify(metadata)}`);

    // lookup -> started -> (finished | failed | aborted); paused can happen
    // before or after started
    let paused = false;
    let aborted = false;
    let finished = false;
    let lookupDone = false;
    let started = false;
    let headedForMetadata = false;

    let resolveAssetId!: (id: string) => void;
    let rejectAssetId!: (err: Error) => void;
    let assetIdSettled = false;
    const assetId = new Promise<string>((resolve, reject) => {
      resolveAssetId = (id) => {
        assetIdSettled = true;
        resolve(id);
      };
      rejectAssetId = (err) => {
        assetIdSettled = true;
        reject(err);
      };
    });

    let resolveUploadId!: (id: string) => void;
    let rejectUploadId!: (err: Error) => void;
    let uploadIdSettled = false;
    const uploadId = new Promise<string>((resolve, reject) => {
      resolveUploadId = (id) => {
        uploadIdSettled = true;
        resolve(id);
      };
      rejectUploadId = (err) => {
        uploadIdSettled = true;
        reject(err);
      };
    });

    let resolveDone!: () => void;
    let rejectDone!: (err: Error) => void;
    const done = new Promise<void>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });

    const failWith = (err: SlubyError) => {
      if (!assetIdSettled) rejectAssetId(err);
      if (!uploadIdSettled) rejectUploadId(err);
      rejectDone(err);
    };

    const upload: tus.Upload = new tus.Upload(file as tus.Upload['file'], {
      endpoint,
      chunkSize,
      retryDelays,
      headers: this._authHeaders(),
      metadata,
      fileReader,
      // a finished upload is forgotten, so the same file uploads again as a
      // new asset next time
      removeFingerprintOnSuccess: true,
      storeFingerprintForResuming: resumeEnabled,
      fingerprint: async (input, opts) => {
        // raw bytes have no name or date to tell two files of one size apart;
        // tus stores nothing for a null fingerprint, its types just omit null
        if (!resumeEnabled || !isBlob(input)) return null as unknown as string;
        const base = await tus.defaultOptions.fingerprint(input as File, opts);
        return base ? `${base}-sluby-${identity}` : base;
      },
      // tus uses XHR in the browser, which only sends cookies cross-origin
      // when withCredentials is set; same-origin requests send them anyway
      onBeforeRequest: withCredentials
        ? (req) => {
            const xhr = req.getUnderlyingObject() as { withCredentials?: boolean } | undefined;
            if (xhr && 'withCredentials' in xhr) xhr.withCredentials = true;
          }
        : undefined,

      onUploadUrlAvailable: () => {
        if (!uploadIdSettled && upload.url) resolveUploadId(uploadIdFromUrl(upload.url));
      },

      onAfterResponse: (_req, res) => {
        if (assetIdSettled) return;
        // a HEAD (and some servers' other responses) carries Upload-Metadata
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
            headers: { ...this._authHeaders(), 'Tus-Resumable': '1.0.0' },
            ...(this._credentials ? { credentials: this._credentials } : {}),
          })
            .then((r) => {
              const meta = r.headers.get('Upload-Metadata');
              if (meta) {
                const id = parseUploadMetadata(meta).videoAssetId;
                if (id && !assetIdSettled) resolveAssetId(id);
              }
            })
            .catch(() => {
              // a HEAD is retried with the next response; until then assetId stays pending
              headedForMetadata = false;
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
        finished = true;
        options.onSuccess?.();
        resolveDone();
      },

      onError: (error: Error) => {
        const err = uploadError(error);
        options.onError?.(err);
        failWith(err);
      },
    });

    const startUpload = () => {
      started = true;
      upload.start();
    };

    // find an unfinished upload of this file to resume, then start unless the
    // caller paused or aborted in the meantime
    const lookup = async () => {
      if (!resumeEnabled) return;
      const previous = await upload.findPreviousUploads();
      for (const candidate of previous) {
        if (aborted) return;
        const state = await this._isUnfinished(candidate.uploadUrl);
        if (state === 'resume') {
          upload.resumeFromPreviousUpload(candidate);
          return;
        }
        if (state === 'stale') {
          await tus.defaultOptions.urlStorage.removeUpload(candidate.urlStorageKey);
        }
      }
    };

    lookup().then(
      () => {
        lookupDone = true;
        if (paused || aborted) return;
        startUpload();
      },
      (err: unknown) => {
        lookupDone = true;
        if (aborted) return;
        const typed = uploadError(err);
        options.onError?.(typed);
        failWith(typed);
      },
    );

    // Avoid unhandled rejections on the id promises if the caller only awaits the handle.
    assetId.catch(() => {});
    uploadId.catch(() => {});

    const handle = done as AssetUploadHandle;
    handle.assetId = assetId;
    handle.uploadId = uploadId;
    handle.pause = async () => {
      if (finished || aborted) return;
      paused = true;
      if (started) await upload.abort(false);
    };
    handle.resume = () => {
      if (!paused || aborted || finished) return;
      paused = false;
      // before the lookup finishes its own continuation starts the upload
      if (lookupDone) startUpload();
    };
    handle.abort = async () => {
      // the server deletes a terminated upload's asset, so never terminate
      // one that finished: cleanup code calling abort() must not delete it
      if (aborted || finished) return;
      aborted = true;
      paused = false;
      try {
        await upload.abort(true);
      } finally {
        // tus fires neither onSuccess nor onError on abort, so settle here or
        // anyone awaiting the handle waits forever
        failWith(new AbortError('Upload aborted.'));
      }
    };
    Object.defineProperty(handle, 'isPaused', {
      get: () => paused,
      enumerable: true,
    });

    const signal = options.signal;
    if (signal) {
      if (signal.aborted) void handle.abort().catch(() => {});
      else
        signal.addEventListener('abort', () => void handle.abort().catch(() => {}), { once: true });
    }

    return handle;
  }

  // -----------------------------------------------------------------------
  // GET /api/v1/uploads/:id
  // -----------------------------------------------------------------------

  /**
   * Retrieve the current status and progress of an upload session, by the
   * `uploadId` of an upload handle.
   */
  async getStatus(uploadId: string, options?: RequestOptions): Promise<UploadSession> {
    const res = await this._fetch(`/api/v1/uploads/${encodeURIComponent(uploadId)}`, {
      signal: options?.signal,
    });
    const body = await readJson(res);

    return {
      id: body.id as string,
      videoAssetId: (body.video_asset_id as string | null | undefined) ?? null,
      status: body.status as UploadSessionStatus,
      progressPercent: body.progress_percent as number,
      fileSize: body.file_size as number,
      uploadedBytes: body.uploaded_bytes as number,
    };
  }

  // -----------------------------------------------------------------------
  // DELETE /api/v1/uploads/:id
  // -----------------------------------------------------------------------

  /**
   * Cancel an in-progress upload and clean up server-side resources, by the
   * `uploadId` of an upload handle.
   */
  async cancel(uploadId: string, options?: RequestOptions): Promise<void> {
    await this._fetch(`/api/v1/uploads/${encodeURIComponent(uploadId)}`, {
      method: 'DELETE',
      signal: options?.signal,
    });
  }
}
