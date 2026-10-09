/*
 * keeps two tabs of the studio from sending the same file at once (FLW-05).
 * a tab claims a file with a web lock before it sends it, so a second tab is
 * refused even when both start in the same instant. every tab also posts what
 * it is sending on a BroadcastChannel every 2 seconds, which is how the
 * others can show "Uploading in another tab, 7%" instead of listing that
 * upload as unfinished and offering to delete it.
 */

const CHANNEL = 'sluby-uploads';
const LOCK_PREFIX = 'sluby-upload:';
export const HEARTBEAT_MS = 2_000;
// a tab that missed two heartbeats is gone (closed, crashed, put to sleep)
const EXPIRE_MS = 3 * HEARTBEAT_MS;

/** An upload this tab is sending, as other tabs see it. */
export interface SharedUpload {
  fingerprint: string;
  uploadId: string | null;
  /** The video the file goes to, once the server created it. */
  assetId: string | null;
  title: string;
  fileName: string;
  bytesUploaded: number;
  bytesTotal: number;
  paused: boolean;
}

/** An upload another tab is sending. */
export interface RemoteUpload extends SharedUpload {
  tabId: string;
}

type Message =
  | { type: 'hello'; tabId: string }
  | { type: 'state'; tabId: string; uploads: SharedUpload[] }
  | { type: 'bye'; tabId: string };

type Channel = Pick<BroadcastChannel, 'postMessage' | 'close'> & {
  onmessage: ((event: MessageEvent) => void) | null;
};

type Locks = Pick<LockManager, 'request'>;

export interface UploadTabsOptions {
  /** null turns the announcements off, as in a browser without BroadcastChannel */
  channel?: Channel | null;
  /** null when the browser has no web locks: the announcements are all there is */
  locks?: Locks | null;
  now?: () => number;
  /** where `pagehide` says goodbye; none outside a browser */
  pageTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
}

/** The file identity both tabs compute alike: what tus fingerprints a browser file by. */
export function fileFingerprint(file: File): string {
  return [file.name, file.type, file.size, file.lastModified].join('-');
}

export interface UploadTabs {
  /**
   * Claim a file for this tab before sending it. Resolves to a release
   * function, or null when another tab is sending the same file.
   */
  claim(fingerprint: string): Promise<(() => void) | null>;
  /** What this tab is sending now; posted at once and then every 2 seconds. */
  publish(uploads: SharedUpload[]): void;
  /** Uploads other tabs are sending, newest report first. Stable between changes. */
  remote(): RemoteUpload[];
  /** Whether another tab says it is sending this file. */
  ownedElsewhere(fingerprint: string): boolean;
  subscribe(listener: () => void): () => void;
  close(): void;
}

function defaultChannel(): Channel | null {
  return typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL) : null;
}

function defaultLocks(): Locks | null {
  return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null;
}

let tabSeq = 0;

export function createUploadTabs(opts: UploadTabsOptions = {}): UploadTabs {
  const now = opts.now ?? Date.now;
  const channel = opts.channel !== undefined ? opts.channel : defaultChannel();
  const locks = opts.locks !== undefined ? opts.locks : defaultLocks();
  const pageTarget =
    opts.pageTarget !== undefined ? opts.pageTarget : typeof window !== 'undefined' ? window : null;
  const tabId = `${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${++tabSeq}`;

  let local: SharedUpload[] = [];
  // what was last posted at once; byte counts alone wait for the heartbeat
  let shape = '';
  const seen = new Map<string, { at: number; uploads: SharedUpload[] }>();
  let snapshot: RemoteUpload[] = [];
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | undefined;

  const post = (message: Message) => {
    try {
      channel?.postMessage(message);
    } catch (err) {
      // a closed channel throws; the next heartbeat would too, so say it once
      console.warn('upload tabs: could not post to the other tabs', err);
    }
  };

  const rebuild = () => {
    const next: RemoteUpload[] = [];
    const entries = [...seen.entries()].sort((a, b) => b[1].at - a[1].at);
    for (const [id, entry] of entries) {
      for (const u of entry.uploads) next.push({ ...u, tabId: id });
    }
    const same =
      next.length === snapshot.length &&
      next.every((u, i) => JSON.stringify(u) === JSON.stringify(snapshot[i]));
    if (same) return;
    snapshot = next;
    listeners.forEach((l) => l());
  };

  const prune = () => {
    const cutoff = now() - EXPIRE_MS;
    for (const [id, entry] of seen) if (entry.at < cutoff) seen.delete(id);
    rebuild();
  };

  const tick = () => {
    if (local.length > 0) post({ type: 'state', tabId, uploads: local });
    prune();
    // nothing to announce and nobody to forget: sleep until something changes
    if (local.length === 0 && seen.size === 0) {
      clearInterval(timer);
      timer = undefined;
    }
  };

  const ensureTimer = () => {
    if (timer === undefined && channel) timer = setInterval(tick, HEARTBEAT_MS);
  };

  if (channel) {
    channel.onmessage = (event: MessageEvent) => {
      const message = event.data as Message | null;
      if (!message || typeof message !== 'object' || message.tabId === tabId) return;
      if (message.type === 'hello') {
        // a tab that just opened should not wait a heartbeat to know
        if (local.length > 0) post({ type: 'state', tabId, uploads: local });
        return;
      }
      if (message.type === 'bye') {
        seen.delete(message.tabId);
      } else if (message.type === 'state' && Array.isArray(message.uploads)) {
        if (message.uploads.length === 0) seen.delete(message.tabId);
        else seen.set(message.tabId, { at: now(), uploads: message.uploads });
        ensureTimer();
      }
      rebuild();
    };
    post({ type: 'hello', tabId });
  }

  const onPageHide = () => post({ type: 'bye', tabId });
  pageTarget?.addEventListener('pagehide', onPageHide);

  const ownedElsewhere = (fingerprint: string) => {
    prune();
    return snapshot.some((u) => u.fingerprint === fingerprint);
  };

  return {
    claim(fingerprint) {
      if (!locks) {
        // no web locks: two tabs starting in the same second could both pass
        // this check, but the announcements still stop every later start
        return Promise.resolve(ownedElsewhere(fingerprint) ? null : () => {});
      }
      return new Promise((resolve, reject) => {
        let release!: () => void;
        const held = new Promise<void>((r) => {
          release = r;
        });
        locks
          .request(`${LOCK_PREFIX}${fingerprint}`, { ifAvailable: true }, async (lock) => {
            if (!lock) {
              resolve(null);
              return;
            }
            resolve(release);
            // the lock is held until this promise settles
            await held;
          })
          .catch(reject);
      });
    },

    publish(uploads) {
      local = uploads;
      const next = JSON.stringify(
        uploads.map((u) => [u.fingerprint, u.uploadId, u.assetId, u.paused]),
      );
      if (next === shape) return;
      // a new, finished or paused upload is news; tell the others at once
      shape = next;
      post({ type: 'state', tabId, uploads });
      if (uploads.length > 0) ensureTimer();
    },

    remote: () => snapshot,

    ownedElsewhere,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    close() {
      clearInterval(timer);
      timer = undefined;
      pageTarget?.removeEventListener('pagehide', onPageHide);
      post({ type: 'bye', tabId });
      if (channel) channel.onmessage = null;
      channel?.close();
    },
  };
}
