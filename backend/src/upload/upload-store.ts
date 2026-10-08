import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { FileStore } from '@tus/file-store';
import { ERRORS, type Server } from '@tus/server';
import type { Logger } from 'pino';

type Log = Pick<Logger, 'info' | 'warn' | 'error'>;

/**
 * How long a tus upload may stay incomplete, counted from its creation. A
 * day leaves room to resume a large upload (MAX_UPLOAD_SIZE is 10 GB by
 * default) after a dropped connection or overnight, and matches the expiry
 * the upload session row already records.
 */
export const UPLOAD_EXPIRY_MS = 24 * 60 * 60 * 1000;

/** How often the backend sweeps expired incomplete uploads. */
export const UPLOAD_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * The tus file store with an expiry sweep that only removes incomplete
 * uploads. The stock FileStore.deleteExpired compares the size against the
 * offset stored in the `<id>.json` sidecar, which it writes once at creation
 * (offset 0) and never updates, so it also deletes finished uploads. Those are
 * sources a failed asset still needs for a retry, so completion is judged
 * from the data file on disk instead, the same way the store answers HEAD.
 */
export class UploadFileStore extends FileStore {
  private readonly log: Log;
  private readonly onBytes?: (uploadId: string) => Promise<void>;

  constructor(options: {
    directory: string;
    expirationPeriodInMilliseconds: number;
    log: Log;
    /**
     * Called when the first bytes of a write arrive, before they are stored,
     * once per write (a PATCH, or a creation that carries data). A failure is
     * logged and the write goes on.
     */
    onBytes?: (uploadId: string) => Promise<void>;
  }) {
    super({
      directory: options.directory,
      expirationPeriodInMilliseconds: options.expirationPeriodInMilliseconds,
    });
    this.log = options.log;
    this.onBytes = options.onBytes;
  }

  override async write(readable: Readable, id: string, offset: number): Promise<number> {
    const onBytes = this.onBytes;
    if (!onBytes) return super.write(readable, id, offset);
    const log = this.log;
    // hooked into the stream rather than a tus event: POST_RECEIVE is
    // throttled to fire after a second, so a short PATCH would never trigger it
    let seen = false;
    const tap = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        if (seen || chunk.length === 0) return done(null, chunk);
        seen = true;
        onBytes(id).then(
          () => done(null, chunk),
          (err: unknown) => {
            log.warn({ uploadId: id, err }, 'Could not record that upload bytes arrived');
            done(null, chunk);
          },
        );
      },
    });
    const [stored, fed] = await Promise.allSettled([
      super.write(tap, id, offset),
      pipeline(readable, tap),
    ]);
    // the store's own error wins: it is what tus maps to a response
    if (stored.status === 'rejected') throw stored.reason;
    if (fed.status === 'rejected') throw ERRORS.FILE_WRITE_ERROR;
    return stored.value;
  }

  override async deleteExpired(): Promise<number> {
    const expiration = this.getExpiration();
    if (expiration <= 0) return 0;
    if (!this.configstore.list) throw ERRORS.UNSUPPORTED_EXPIRATION_EXTENSION;

    const now = Date.now();
    let removed = 0;
    for (const id of await this.configstore.list()) {
      try {
        const upload = await this.getUpload(id);
        const expiresAt = new Date(upload.creation_date ?? now).getTime() + expiration;
        if (now <= expiresAt) continue;
        if (upload.size !== undefined && upload.offset === upload.size) continue;
        await this.remove(id);
        removed++;
        this.log.info(
          {
            uploadId: id,
            offset: upload.offset,
            size: upload.size,
            createdAt: upload.creation_date,
          },
          'Removed expired incomplete upload',
        );
      } catch (err) {
        // one unreadable upload must not stop the sweep of the others
        this.log.error(
          { uploadId: id, directory: this.directory, err },
          'Expired upload sweep could not handle upload',
        );
      }
    }
    return removed;
  }
}

/** Run one expiry sweep through the tus server, logging the outcome. */
export async function sweepExpiredUploads(
  server: Pick<Server, 'cleanUpExpiredUploads'>,
  log: Log,
): Promise<number> {
  try {
    const removed = await server.cleanUpExpiredUploads();
    log.info({ removed }, 'Swept expired incomplete uploads');
    return removed;
  } catch (err) {
    log.error({ err }, 'Expired upload sweep failed');
    return 0;
  }
}
