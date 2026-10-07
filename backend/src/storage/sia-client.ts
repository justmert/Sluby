/**
 * Sia storage client — talks to an `indexd` instance via the official
 * `sia-storage` SDK (NAPI bindings around `sia-sdk-rs`).
 *
 * Why this shape:
 *   - `indexd` is the Sia Foundation's indexer daemon. It manages
 *     contracts, accounts, and erasure-coded slabs across hosts.
 *   - `sia-storage` is the official SDK (npm `sia-storage`). It signs
 *     all requests with an AppKey, talks to indexd's app API, and
 *     uploads shards directly to hosts via siamux/QUIC.
 *
 *   - Onboarding flow (run once per indexd instance):
 *       1. mint a connect key:   POST /api/apps/connect/keys (admin)
 *       2. open Builder.requestConnection() in the SDK
 *       3. approve via POST <responseUrl> with the connect key
 *       4. Builder.register(phrase) returns the SDK; export AppKey
 *       5. set SIA_APP_ID + SIA_APP_KEY in .env so the backend can
 *          re-attach via Builder.connected(appKey) at startup.
 *
 *   - Object IDs are returned by the SDK (32-byte hex strings).
 *     `video_assets.manifest_object_id` and friends store whatever
 *     the SDK gives us — no DB migration needed since the shape is
 *     unchanged from the previous renterd path.
 *
 *   - Per-sector contract IDs are not exposed by the SDK (it returns
 *     {root, hostKey} per sector). We pull the {host → contractIDs}
 *     map from indexd's admin API once and cache it in-process.
 */

import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { initSia, AppKey, Builder, setLogger } from '@siafoundation/sia-storage';
import type {
  Host,
  PackedUploadOptions,
  PinnedObject as SdkPinnedObject,
  Sdk,
} from '@siafoundation/sia-storage';
import type { ObjectSnapshot } from './sia-breakdown.js';
import { siaUploadDurationSeconds } from '../metrics/collector.js';

// the sdk's node entry ships its own declarations (the backend resolves them
// through the "node" export condition, see customConditions in tsconfig)

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface UploadResult {
  objectId: string;
  size: number;
}

// ---------------------------------------------------------------------------
// SDK init (singleton)
// ---------------------------------------------------------------------------

const APP_META = {
  // 32-byte unique app identifier. Same value across restarts so indexd
  // associates uploads with the same registered application row.
  id: Buffer.from(env.SIA_APP_ID, 'hex'),
  name: 'Sluby',
  description: 'Decentralised video streaming on the Sia network',
  serviceUrl: env.PUBLIC_URL,
};

let sdkPromise: Promise<Sdk> | null = null;

/** Initialises sia-storage + connects to indexd. Idempotent. */
export function getClient(): Promise<Sdk> {
  if (!sdkPromise) {
    sdkPromise = (async () => {
      logger.info({ indexer: env.SIA_INDEXER_URL }, 'Connecting to indexd via sia-storage SDK');
      await initSia();
      // Forward SDK debug logs into pino at the matching level so
      // upload/download progress shows up in the same stream as the
      // rest of the backend.
      setLogger((msg) => logger.debug({ src: 'sia-storage' }, msg), 'debug');

      const appKey = new AppKey(Buffer.from(env.SIA_APP_KEY, 'hex'));
      const builder = new Builder(env.SIA_INDEXER_URL, APP_META);
      const sdk = await builder.connected(appKey);
      if (!sdk) {
        throw new Error(
          'sia-storage Builder.connected() returned null — the AppKey is not registered with the configured indexd. ' +
            'Mint a connect key (POST /api/apps/connect/keys), call Builder.requestConnection(), approve via ' +
            'POST <responseUrl> with the connect key, then Builder.register(phrase) and persist the resulting AppKey.',
        );
      }

      const account = await sdk.account();
      logger.info(
        {
          accountKey: account.accountKey,
          ready: account.ready,
          remainingStorage: account.remainingStorage.toString(),
        },
        'sia-storage SDK ready',
      );
      return sdk;
    })().catch((err) => {
      sdkPromise = null;
      throw err;
    });
  }
  return sdkPromise;
}

// ---------------------------------------------------------------------------
// Host → contract index (cached, refreshed lazily)
// ---------------------------------------------------------------------------

interface HostContractMap {
  /** map of host pubkey → list of file-contract IDs covering shards on that host. */
  contracts: Map<string, string[]>;
  fetchedAt: number;
}

const HOST_CONTRACT_TTL_MS = 60_000;
let hostContractCache: HostContractMap | null = null;

const ADMIN_AUTH = `Basic ${Buffer.from(`:${env.SIA_ADMIN_PASSWORD}`).toString('base64')}`;

/**
 * The indexd admin API (contracts, wallet) only exists on a self-hosted
 * indexd, which needs its admin password configured. A hosted indexer such as
 * sia.storage exposes only the app API, so without a password the admin
 * lookups are skipped instead of failing on every call.
 */
export const ADMIN_API_CONFIGURED = env.SIA_ADMIN_PASSWORD !== '';

interface AdminContractResponse {
  id: string;
  hostKey: string;
  state: string;
  good: boolean;
}

interface AdminWalletResponse {
  address: string;
}

async function refreshHostContracts(): Promise<HostContractMap> {
  if (!ADMIN_API_CONFIGURED) return { contracts: new Map(), fetchedAt: Date.now() };
  if (hostContractCache && Date.now() - hostContractCache.fetchedAt < HOST_CONTRACT_TTL_MS) {
    return hostContractCache;
  }
  try {
    const url = `${env.SIA_ADMIN_URL.replace(/\/$/, '')}/api/contracts`;
    const res = await fetch(url, { headers: { Authorization: ADMIN_AUTH } });
    if (!res.ok) {
      throw new Error(`indexd admin /api/contracts → ${res.status}`);
    }
    const list = (await res.json()) as AdminContractResponse[];
    const contracts = new Map<string, string[]>();
    for (const c of list) {
      if (c.state !== 'active' || !c.good) continue;
      const arr = contracts.get(c.hostKey);
      if (arr) arr.push(c.id);
      else contracts.set(c.hostKey, [c.id]);
    }
    hostContractCache = { contracts, fetchedAt: Date.now() };
    logger.debug(
      { hosts: contracts.size, contractCount: list.length },
      'Refreshed indexd host→contract map',
    );
    return hostContractCache;
  } catch (err) {
    logger.warn({ err }, 'Failed to refresh host→contract map');
    // keep serving the last good map, and back off for a ttl instead of
    // retrying on every object lookup
    hostContractCache = {
      contracts: hostContractCache?.contracts ?? new Map(),
      fetchedAt: Date.now(),
    };
    return hostContractCache;
  }
}

/**
 * Active file contracts per host, from the indexd admin API. Null when no
 * admin API is configured, so callers can tell "none" from "unknown".
 */
export async function getHostContracts(): Promise<Map<string, string[]> | null> {
  if (!ADMIN_API_CONFIGURED) return null;
  return (await refreshHostContracts()).contracts;
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

function bytesToStream(data: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
}

/**
 * Erasure-coding options for uploads. Only pass a shard ratio when the
 * operator configured BOTH; otherwise omit it so the SDK uses its default of
 * 10 data + 20 parity shards. A ratio meant for a small testnet pool (e.g. the
 * Zen 2/4) fails on sia.storage, so it must never leak into a mainnet setup.
 */
function erasureOptions(): PackedUploadOptions | undefined {
  if (env.SIA_DATA_SHARDS != null && env.SIA_PARITY_SHARDS != null) {
    return { dataShards: env.SIA_DATA_SHARDS, parityShards: env.SIA_PARITY_SHARDS };
  }
  return undefined;
}

/**
 * A packed upload that has stored no shard for this long is hung and gets
 * cancelled. The SDK bounds each host write (90 s) and each indexer call
 * (45 s), but not the upload as a whole, which can wait on hosts for good.
 */
export const UPLOAD_STALL_TIMEOUT_MS = 10 * 60 * 1000;

export interface PackedUploadHooks {
  /**
   * Gets the object ids once the data is stored and before any object is
   * pinned, so the caller can record them first and a crash after the pin
   * still leaves a record of what to unpin. A throw here pins nothing.
   */
  beforePin?: (objectIds: string[]) => Promise<void>;
  stallTimeoutMs?: number;
}

/** Upload a single Uint8Array as one packed object. */
export async function uploadAndPin(
  data: Uint8Array,
  hooks: PackedUploadHooks = {},
): Promise<UploadResult> {
  const [result] = await uploadAndPinPacked([data], hooks);
  return result;
}

/** One item of a packed upload: bytes in memory, or a file the SDK reads from disk. */
export type PackedSource = Uint8Array | { path: string };

/**
 * Upload N items in a single packed batch. Every upload costs at least one
 * full slab on the wire (all data and parity shards), however little data it
 * holds, so packing small items together is far cheaper than uploading each
 * one on its own. Large items simply span more slabs, which the SDK uploads
 * concurrently.
 *
 * The SDK pins each slab as soon as it is stored, before any object exists,
 * so a failed upload leaves pinned slabs behind; they are pruned once no
 * other upload is in flight (see pruneSlabs).
 */
export async function uploadAndPinPacked(
  items: PackedSource[],
  hooks: PackedUploadHooks = {},
): Promise<UploadResult[]> {
  if (items.length === 0) return [];
  const sdk = await getClient();
  await pruneGate.beginUpload();
  try {
    return await packedUpload(sdk, items, hooks);
  } catch (err) {
    requestSlabPrune('failed upload');
    throw err;
  } finally {
    pruneGate.endUpload();
  }
}

async function packedUpload(
  sdk: Sdk,
  items: PackedSource[],
  hooks: PackedUploadHooks,
): Promise<UploadResult[]> {
  const endTimer = siaUploadDurationSeconds.startTimer();
  const stallMs = hooks.stallTimeoutMs ?? UPLOAD_STALL_TIMEOUT_MS;
  let onStall: (err: Error) => void = () => {};
  const stalled = new Promise<never>((_, reject) => {
    onStall = reject;
  });
  const timer = setTimeout(() => {
    packed.cancel();
    onStall(
      new Error(`Sia upload stored nothing for ${Math.round(stallMs / 1000)}s and was cancelled`),
    );
  }, stallMs);
  const progressed = () => {
    timer.refresh();
  };
  const packed = sdk.uploadPacked({ ...erasureOptions(), onShardUploaded: progressed });

  let objects: SdkPinnedObject[];
  try {
    const work = (async () => {
      for (const item of items) {
        // files are read in rust rather than streamed chunk by chunk through js
        if (item instanceof Uint8Array) await packed.add(bytesToStream(item));
        else await packed.addPath(item.path);
        progressed();
      }
      return packed.finalize();
    })();
    // after a stall the cancelled calls reject too, with nobody waiting
    work.catch(() => {});
    objects = await Promise.race([work, stalled]);
  } catch (err) {
    // stops the slab uploads still running; the ones already stored stay pinned
    packed.cancel();
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (objects.length !== items.length) {
    throw new Error(`uploadAndPinPacked expected ${items.length} objects, got ${objects.length}`);
  }
  await hooks.beforePin?.(objects.map((obj) => obj.id()));

  // pin in parallel: each pin is one indexd http call, no host round trip
  const pins = await Promise.allSettled(objects.map((obj) => sdk.pinObject(obj)));
  const failed = pins.find((p): p is PromiseRejectedResult => p.status === 'rejected');
  if (failed) {
    // without beforePin the caller never learns these ids, so unpin them here
    await Promise.allSettled(
      objects
        .filter((_, i) => pins[i].status === 'fulfilled')
        .map((obj) => sdk.deleteObject(obj.id())),
    );
    throw failed.reason;
  }
  endTimer();
  const results = objects.map((obj) => ({
    objectId: obj.id(),
    size: Number(obj.size()),
  }));
  logger.info(
    { count: results.length, totalBytes: results.reduce((n, r) => n + r.size, 0) },
    'Packed batch uploaded + pinned to Sia',
  );
  return results;
}

// ---------------------------------------------------------------------------
// Download (with byte-range passthrough)
// ---------------------------------------------------------------------------

/** One object as the indexer describes it, ready to stream. */
export interface ObjectHandle {
  id: string;
  size: number;
  /**
   * Stream the object, or `length` bytes of it from `offset`. The hosts are
   * only asked for the slabs the window overlaps, and the stream applies
   * backpressure, so a slow reader never makes the whole window sit in memory.
   */
  read(range?: { offset: number; length: number }): ReadableStream<Uint8Array>;
}

// decoded 128 KiB chunks the sdk may queue ahead of a slow reader. Left to
// its default it reads far ahead: a 240 MiB object read in full grew the
// process by about 200 MB, and by about 100 MB with 4, which is then the
// sdk's own per-download working set and no longer grows with the object.
const DOWNLOAD_BUFFERED_CHUNKS = 4;

/**
 * Look an object up on the indexer once and return a handle that streams it.
 * One indexer call: the handle carries what the download needs.
 */
export async function openObject(objectId: string): Promise<ObjectHandle> {
  const sdk = await getClient();
  const obj = await sdk.object(objectId);
  const size = Number(obj.size());
  return {
    id: objectId,
    size,
    read: (range) =>
      sdk.download(obj, {
        maxBufferedChunks: DOWNLOAD_BUFFERED_CHUNKS,
        ...(range ? { offset: BigInt(range.offset), length: BigInt(range.length) } : {}),
      }) as ReadableStream<Uint8Array>,
  };
}

/**
 * Read a whole stream into one buffer of the length it must have. Throws when
 * the stream ends short or runs long, so a truncated read is never passed on
 * as the object. Only for objects small enough to hold in memory.
 */
export async function readExactly(
  stream: ReadableStream<Uint8Array>,
  length: number,
): Promise<Uint8Array> {
  const out = new Uint8Array(length);
  const reader = stream.getReader();
  let filled = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (filled + value.length > length) {
        throw new Error(`object stream ran past its ${length} bytes`);
      }
      out.set(value, filled);
      filled += value.length;
    }
  } catch (err) {
    await reader.cancel().catch(() => {});
    throw err;
  }
  if (filled !== length) throw new Error(`object stream ended at ${filled} of ${length} bytes`);
  return out;
}

/**
 * Download a whole object (or a window of it) into memory. For small objects
 * only: the gateway streams anything large instead.
 */
export async function downloadObject(
  objectId: string,
  options?: { offset?: number; length?: number },
): Promise<Uint8Array> {
  const handle = await openObject(objectId);
  const offset = options?.offset ?? 0;
  const length = options?.length ?? handle.size - offset;
  const out =
    length === 0 ? new Uint8Array(0) : await readExactly(handle.read({ offset, length }), length);
  logger.debug({ objectId, offset, length }, 'Object downloaded from Sia');
  return out;
}

/**
 * Whether an SDK error is the indexer saying it has no such object (it was
 * unpinned, or never existed on this account). The SDK reports indexer api
 * errors as `Api(<status>, "<message>")` in the error text and carries no
 * status field, so the status is read from there.
 */
export function isIndexerNotFound(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /\bApi\(404\b/.test(message);
}

// ---------------------------------------------------------------------------
// Object change feed (used by the reconciliation worker)
// ---------------------------------------------------------------------------

/** A single object-change event, flattened out of the SDK's getters. */
export interface ObjectEventPage {
  id: string;
  deleted: boolean;
  updatedAt: Date;
}

/**
 * Fetch one page of the indexer's object change feed. The SDK exposes no
 * "list all objects" call, so reconciliation reads this cursor feed into its
 * saved copy of the inventory (see reconcile/collect-inventory.ts).
 */
export async function listObjectEventsPage(
  cursor: { id: string; after: Date } | null,
  limit: number,
): Promise<ObjectEventPage[]> {
  const sdk = await getClient();
  const events = await sdk.objectEvents(cursor, limit);
  return events.map((e) => ({
    id: e.id,
    deleted: e.deleted,
    updatedAt: e.updatedAt,
  }));
}

// ---------------------------------------------------------------------------
// Metadata (used by sia-info)
// ---------------------------------------------------------------------------

/**
 * Everything the indexer reports about one object, as plain data: sizes
 * (including the erasure-coded size), and each slab's shard config, byte range
 * and sector placement. Used for the per-asset storage breakdown.
 */
export async function inspectObject(objectId: string): Promise<ObjectSnapshot> {
  const sdk = await getClient();
  const obj = await sdk.object(objectId);
  return {
    id: obj.id(),
    size: Number(obj.size()),
    encodedSize: Number(obj.encodedSize()),
    slabs: obj.slabs().map((slab) => ({
      minShards: slab.minShards,
      offset: slab.offset,
      length: slab.length,
      sectors: slab.sectors.map((sec) => ({ root: sec.root, hostKey: sec.hostKey })),
    })),
    createdAt: obj.createdAt().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Share URLs (direct-from-Sia playback)
// ---------------------------------------------------------------------------

/**
 * Mint a public, time-limited `sia://<ref>#<key>` share URL for a single
 * object. The decryption key rides in the URL fragment, so ANY registered Sia
 * app key (e.g. the browser player's low-privilege viewer key) can resolve and
 * download the object until `validUntil` without holding the owner's key. This
 * is what lets the player pull bytes directly from Sia with the backend out of
 * the byte path. One object = one URL (the SDK has no graph share).
 */
export async function shareObjectUrl(objectId: string, validUntil: Date): Promise<string> {
  const sdk = await getClient();
  const obj = await sdk.object(objectId);
  return sdk.objectShareUrl(obj, validUntil);
}

// ---------------------------------------------------------------------------
// Account / hosts (studio dashboard)
// ---------------------------------------------------------------------------

/** The indexer account this backend stores under, with usage in bytes. */
export interface IndexerAccount {
  accountKey: string;
  ready: boolean;
  appName: string;
  /** Logical bytes pinned (what was uploaded). */
  pinnedData: number;
  /** Bytes the pinned data occupies on hosts, after erasure coding. */
  pinnedSize: number;
  maxPinnedData: number;
  remainingStorage: number;
  lastUsed: string;
}

export async function getAccountInfo(): Promise<IndexerAccount> {
  const sdk = await getClient();
  const account = await sdk.account();
  return {
    accountKey: account.accountKey,
    ready: account.ready,
    appName: account.app?.name ?? '',
    pinnedData: Number(account.pinnedData),
    pinnedSize: Number(account.pinnedSize),
    maxPinnedData: Number(account.maxPinnedData),
    remainingStorage: Number(account.remainingStorage),
    lastUsed: account.lastUsed.toISOString(),
  };
}

/** A storage provider the indexer can place sectors on. */
export interface IndexerHost {
  publicKey: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  goodForUpload: boolean;
}

// the indexer pages its host list; one call only returns the first page
const HOST_PAGE_SIZE = 100;
const HOST_PAGE_LIMIT = 100;

export async function listHosts(): Promise<IndexerHost[]> {
  const sdk = await getClient();
  const hosts: Host[] = [];
  for (let page = 0; page < HOST_PAGE_LIMIT; page++) {
    const batch = await sdk.hosts({ limit: HOST_PAGE_SIZE, offset: page * HOST_PAGE_SIZE });
    hosts.push(...batch);
    if (batch.length < HOST_PAGE_SIZE) break;
  }
  return hosts.map((h) => ({
    publicKey: h.publicKey,
    countryCode: h.countryCode,
    latitude: h.latitude,
    longitude: h.longitude,
    goodForUpload: h.goodForUpload,
  }));
}

// ---------------------------------------------------------------------------
// Delete / maintenance
// ---------------------------------------------------------------------------

/** What unpinning found: the object was pinned, or the indexer did not have it. */
export type UnpinOutcome = 'unpinned' | 'not-found';

/**
 * Unpin an object. One the indexer does not have counts as done: it was
 * unpinned before (a deletion that crashed after the unpin and before
 * recording it), or never pinned (an id recorded just before its pin).
 */
export async function deleteObject(objectId: string): Promise<UnpinOutcome> {
  const sdk = await getClient();
  try {
    await sdk.deleteObject(objectId);
  } catch (err) {
    if (!isIndexerNotFound(err)) throw err;
    logger.info({ objectId }, 'Object was not pinned on indexd');
    return 'not-found';
  }
  logger.info({ objectId }, 'Object deleted from indexd');
  return 'unpinned';
}

/**
 * Keeps slab pruning and uploads apart. indexd prunes every slab of the
 * account that no pinned object references (persist/postgres/slabs.go
 * PruneSlabs), and the SDK pins each slab of an upload as soon as it is
 * stored but the objects only at the end, so a prune during an upload strips
 * that upload's slabs: indexd drops their sector records, and the SDK's pin
 * then has to re-pin slabs whose sectors the hosts may already have dropped.
 * Uploads and prunes all go through this process (the workers and the API
 * share it), so an in-process gate is enough: a prune waits until no upload
 * is in flight, and uploads wait for a running prune.
 */
class SlabPruneGate {
  private uploads = 0;
  private wanted = false;
  private running: Promise<void> | null = null;

  constructor(private readonly prune: () => Promise<void>) {}

  async beginUpload(): Promise<void> {
    while (this.running) await this.running.catch(() => {});
    this.uploads += 1;
  }

  endUpload(): void {
    this.uploads -= 1;
    if (this.uploads === 0 && this.wanted) {
      this.start().catch((err: unknown) => {
        logger.warn({ err }, 'Deferred slab prune failed');
      });
    }
  }

  async request(): Promise<'pruned' | 'deferred'> {
    if (this.running) {
      // it may have read the slab list before the caller unpinned anything
      await this.running.catch(() => {});
      return this.request();
    }
    if (this.uploads > 0) {
      this.wanted = true;
      return 'deferred';
    }
    await this.start();
    return 'pruned';
  }

  private start(): Promise<void> {
    if (this.running) return this.running;
    this.wanted = false;
    this.running = this.prune().finally(() => {
      this.running = null;
    });
    return this.running;
  }
}

const pruneGate = new SlabPruneGate(async () => {
  const sdk = await getClient();
  await sdk.pruneSlabs();
  logger.info('Pruned slabs no object references');
});

/**
 * Unpin the account's slabs that no object references: the slabs of objects
 * deleted since, and the slabs a failed upload stored. indexd only prunes on
 * this request, it has no background prune. Runs now when no upload is in
 * flight, otherwise once the last one ends ('deferred').
 */
export function pruneSlabs(): Promise<'pruned' | 'deferred'> {
  return pruneGate.request();
}

function requestSlabPrune(reason: string): void {
  pruneSlabs().catch((err: unknown) => {
    logger.warn({ err, reason }, 'Slab prune failed');
  });
}

/**
 * Fetch the indexd wallet address. Cached — the seed doesn't change
 * after boot, so one lookup per process lifetime is fine.
 */
let walletAddressCache: string | null = null;
export async function getWalletAddress(): Promise<string | null> {
  if (!ADMIN_API_CONFIGURED) return null;
  if (walletAddressCache) return walletAddressCache;
  try {
    const url = `${env.SIA_ADMIN_URL.replace(/\/$/, '')}/api/wallet`;
    const res = await fetch(url, { headers: { Authorization: ADMIN_AUTH } });
    if (!res.ok) {
      throw new Error(`indexd admin /api/wallet → ${res.status}`);
    }
    const body = (await res.json()) as AdminWalletResponse;
    walletAddressCache = body.address ?? null;
    return walletAddressCache;
  } catch (err) {
    logger.warn({ err }, 'Failed to fetch indexd wallet address');
    return null;
  }
}

// NOTE: signed playback URLs are built in delivery/signed-url.ts, which
// HMACs the object id together with its expiry and the asset's signing
// generation so the gateway can verify them. An earlier helper here produced an `?expires=` URL with no
// signature and nothing enforcing the expiry, which only looked like access
// control; it was removed rather than left as a false guarantee.
