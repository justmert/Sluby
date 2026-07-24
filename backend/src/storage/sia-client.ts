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
import {
  initSia,
  AppKey,
  Builder,
  setLogger,
} from 'sia-storage';

// sia-storage 0.0.8 has a packaging quirk: its `exports` map puts the
// `types` key at the root of the conditional fork instead of inside the
// "node" branch, so TypeScript reads the WASM-shaped declarations even
// though Node loads the NAPI binary. The runtime contract is the one
// in `dist/index.node.d.ts`. We declare the subset we use locally.
type Buf = Buffer;
interface NapiAppMetadata {
  id: Buf;
  name: string;
  description: string;
  serviceUrl: string;
  logoUrl?: string;
  callbackUrl?: string;
}
interface NapiPinnedSector {
  root: string;
  hostKey: string;
}
interface NapiSlab {
  encryptionKey: Buf;
  minShards: number;
  sectors: NapiPinnedSector[];
  offset: number;
  length: number;
}
interface NapiPinnedObject {
  id(): string;
  size(): bigint;
  slabs(): NapiSlab[];
  createdAt(): Date;
  updatedAt(): Date;
}
interface NapiPackedUpload {
  add(stream: ReadableStream<Uint8Array>): Promise<bigint>;
  finalize(): Promise<NapiPinnedObject[]>;
}
interface NapiUploadOptions {
  dataShards?: number;
  parityShards?: number;
}
interface NapiDownloadOptions {
  offset?: bigint;
  length?: bigint;
}
interface NapiAccount {
  accountKey: string;
  ready: boolean;
  remainingStorage: bigint;
}
/** A single entry from the indexer's object change feed. */
interface NapiObjectEvent {
  readonly id: string;
  readonly deleted: boolean;
  readonly updatedAt: Date;
}
/** Cursor to resume the object change feed after a given event. */
interface NapiObjectsCursor {
  id: string;
  after: Date;
}
interface NapiSdk {
  uploadPacked(options?: NapiUploadOptions): NapiPackedUpload;
  pinObject(object: NapiPinnedObject): Promise<void>;
  object(key: string): Promise<NapiPinnedObject>;
  download(object: NapiPinnedObject, options?: NapiDownloadOptions): ReadableStream<Uint8Array>;
  objectEvents(cursor: NapiObjectsCursor | null, limit: number): Promise<NapiObjectEvent[]>;
  deleteObject(key: string): Promise<void>;
  pruneSlabs(): Promise<void>;
  account(): Promise<NapiAccount>;
}
interface NapiBuilder {
  connected(appKey: NapiAppKey): Promise<NapiSdk | null>;
}
interface NapiAppKey {
  publicKey(): string;
  export(): Buf;
}

// Casts here, not at every call site downstream. Constructors come from
// the package; we just retype the surface to the NAPI shape.
const NapiAppKeyCtor = AppKey as unknown as new (key: Buf) => NapiAppKey;
const NapiBuilderCtor = Builder as unknown as new (
  indexerUrl: string,
  appMeta: NapiAppMetadata,
) => NapiBuilder;

// ---------------------------------------------------------------------------
// Public types (kept identical to the previous shape so the rest of
// the codebase — uploader, aggregator, sia-info — compiles unchanged).
// ---------------------------------------------------------------------------

export interface UploadResult {
  objectId: string;
  size: number;
}

/**
 * A lightweight "PinnedObject" stand-in. Upstream callers only use
 * `.id()`, `.size()`, `.slabs()`, `.createdAt()`, `.updatedAt()`.
 */
export interface PinnedObject {
  id(): string;
  size(): bigint;
  slabs(): RawSlab[];
  createdAt(): Date | null;
  updatedAt(): Date | null;
}

/** Matches the shape upstream code pulls `minShards` / `sectors` from. */
export interface RawSlab {
  minShards: number;
  sectors: Array<{
    root: string;
    hostKey: string;
    /** Sia file-contract id committing this host to storing the sector.
     *  Pulled from the indexd contracts list and joined on hostKey;
     *  empty string when no active contract is on file for the host. */
    contractId: string;
  }>;
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

let sdkPromise: Promise<NapiSdk> | null = null;

/** Initialises sia-storage + connects to indexd. Idempotent. */
export function getClient(): Promise<NapiSdk> {
  if (!sdkPromise) {
    sdkPromise = (async () => {
      logger.info(
        { indexer: env.SIA_INDEXER_URL },
        'Connecting to indexd via sia-storage SDK',
      );
      await initSia();
      // Forward SDK debug logs into pino at the matching level so
      // upload/download progress shows up in the same stream as the
      // rest of the backend.
      setLogger((msg) => logger.debug({ src: 'sia-storage' }, msg), 'debug');

      const appKey = new NapiAppKeyCtor(Buffer.from(env.SIA_APP_KEY, 'hex'));
      const builder = new NapiBuilderCtor(env.SIA_INDEXER_URL, APP_META);
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
  if (
    hostContractCache &&
    Date.now() - hostContractCache.fetchedAt < HOST_CONTRACT_TTL_MS
  ) {
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
    return hostContractCache ?? { contracts: new Map(), fetchedAt: Date.now() };
  }
}

// ---------------------------------------------------------------------------
// Slab/object adapters
// ---------------------------------------------------------------------------

function adaptSlabs(slabs: NapiSlab[], hostContracts: Map<string, string[]>): RawSlab[] {
  return slabs.map((slab) => ({
    minShards: slab.minShards,
    sectors: slab.sectors.map((sec) => {
      const contractId = hostContracts.get(sec.hostKey)?.[0] ?? '';
      return { root: sec.root, hostKey: sec.hostKey, contractId };
    }),
  }));
}

function adaptObject(
  obj: NapiPinnedObject,
  hostContracts: Map<string, string[]>,
): PinnedObject {
  // Snapshot the SDK fields once — calling them across an async boundary
  // re-acquires the inner mutex on every call.
  const id = obj.id();
  const size = obj.size();
  const slabs = adaptSlabs(obj.slabs(), hostContracts);
  const createdAt = obj.createdAt();
  const updatedAt = obj.updatedAt();
  return {
    id: () => id,
    size: () => size,
    slabs: () => slabs,
    createdAt: () => createdAt,
    updatedAt: () => updatedAt,
  };
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

/** Upload a single Uint8Array as one packed object. */
export async function uploadAndPin(data: Uint8Array): Promise<UploadResult> {
  const sdk = await getClient();
  const packed = sdk.uploadPacked({
    dataShards: env.SIA_DATA_SHARDS,
    parityShards: env.SIA_PARITY_SHARDS,
  });
  await packed.add(bytesToStream(data));
  const objects = await packed.finalize();
  if (objects.length !== 1) {
    throw new Error(
      `uploadAndPin expected 1 packed object, got ${objects.length}`,
    );
  }
  const obj = objects[0];
  await sdk.pinObject(obj);
  const objectId = obj.id();
  logger.info(
    { objectId, size: data.length },
    'Object uploaded + pinned to Sia',
  );
  return { objectId, size: data.length };
}

/**
 * Upload N Uint8Arrays in a single packed batch. Each item shares slabs
 * with its neighbours, which is materially cheaper than N independent
 * uploads when the items are small (e.g. HLS playlist + thumbnails).
 */
export async function uploadAndPinPacked(
  items: Uint8Array[],
): Promise<UploadResult[]> {
  if (items.length === 0) return [];
  const sdk = await getClient();
  const packed = sdk.uploadPacked({
    dataShards: env.SIA_DATA_SHARDS,
    parityShards: env.SIA_PARITY_SHARDS,
  });
  for (const data of items) {
    await packed.add(bytesToStream(data));
  }
  const objects = await packed.finalize();
  if (objects.length !== items.length) {
    throw new Error(
      `uploadAndPinPacked expected ${items.length} objects, got ${objects.length}`,
    );
  }
  // Pin in parallel — each pin is an indexd HTTP call, no host round-trip.
  await Promise.all(objects.map((obj) => sdk.pinObject(obj)));
  const results = objects.map((obj, i) => ({
    objectId: obj.id(),
    size: items[i].length,
  }));
  logger.info(
    { count: results.length, totalBytes: items.reduce((n, b) => n + b.length, 0) },
    'Packed batch uploaded + pinned to Sia',
  );
  return results;
}

// ---------------------------------------------------------------------------
// Download (with byte-range passthrough)
// ---------------------------------------------------------------------------

export async function downloadObject(
  objectId: string,
  options?: { offset?: number; length?: number },
): Promise<Uint8Array> {
  const sdk = await getClient();
  const obj = await sdk.object(objectId);
  const stream = sdk.download(obj, {
    offset: options?.offset !== undefined ? BigInt(options.offset) : undefined,
    length: options?.length !== undefined ? BigInt(options.length) : undefined,
  });
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  logger.debug(
    { objectId, size: out.length, range: options ? `${options.offset ?? 0}+${options.length ?? '∞'}` : 'full' },
    'Object downloaded from Sia',
  );
  return out;
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
 * "list all objects" call, so reconciliation replays this cursor feed to
 * reconstruct the current inventory (see reconcile/collect-inventory.ts).
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
// Metadata / object handle (used by aggregator + sia-info)
// ---------------------------------------------------------------------------

export async function getObject(objectId: string): Promise<PinnedObject> {
  const sdk = await getClient();
  const obj = await sdk.object(objectId);
  const { contracts } = await refreshHostContracts();
  return adaptObject(obj, contracts);
}

// ---------------------------------------------------------------------------
// Delete / maintenance
// ---------------------------------------------------------------------------

export async function deleteObject(objectId: string): Promise<void> {
  const sdk = await getClient();
  await sdk.deleteObject(objectId);
  logger.info({ objectId }, 'Object deleted from indexd');
}

/**
 * Unpin slabs that aren't referenced by any object on this account.
 * indexd's autopilot also runs this in the background, but giving it a
 * push from the queue worker means freed storage shows up in dashboard
 * metrics promptly.
 */
export async function pruneSlabs(): Promise<void> {
  const sdk = await getClient();
  await sdk.pruneSlabs();
  logger.debug('pruneSlabs() executed against indexd');
}

/**
 * Fetch the indexd wallet address. Cached — the seed doesn't change
 * after boot, so one lookup per process lifetime is fine.
 */
let walletAddressCache: string | null = null;
export async function getWalletAddress(): Promise<string | null> {
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
// HMACs the object id together with its expiry so the gateway can verify
// them. An earlier helper here produced an `?expires=` URL with no
// signature and nothing enforcing the expiry, which only looked like access
// control; it was removed rather than left as a false guarantee.
