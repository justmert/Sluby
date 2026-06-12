/**
 * Sia storage client — wraps two Sia Foundation TS packages because each
 * has a complementary bug. Both come from the same upstream Rust source
 * (sia-sdk-rs); the divergence is due to publish-time skew.
 *
 * Why two packages?
 *
 *   1. `sia-storage@0.0.5` (published 2026-04-12, after indexd's Mar-18
 *      breaking change to PinObjectRequest). Signing format matches
 *      indexd master: pin/share/account/download all work. BUT its
 *      native binary's `add(readFn)` callback path crashes with
 *      "i/o error: Get TypedArray info failed" (a NAPI Buffer
 *      thread-safe-function bug), so we cannot use it for upload.
 *
 *   2. `@siafoundation/sia@0.6.6` (published 2026-03-17, before the
 *      Mar-18 indexd change). Its native binary's `uploadPacked.add(data)`
 *      takes a Buffer directly (no callback) → upload works. BUT the
 *      pin path is built against the old PinObjectRequest format and
 *      indexd master rejects it with "object ID does not match slabs".
 *
 * The bridge: upload via package 2, then move the resulting object
 * across via the SDK's own `seal(appKey)` JSON serialization, then pin
 * via package 1. This is documented and reversible — `seal/open` is the
 * Sia SDK's normal serialization for sharing/transferring objects.
 *
 * NOTE on the word "seal": this is the Sia SDK's terminology for
 * "encrypted-on-the-wire object form" (see SealedObject in the Sia
 * docs). It is unrelated to the `the Sia SDK` package (Move
 * threshold encryption) that was removed during the Sluby →
 * SiaStream conversion. Different concept, different organization.
 */

import {
  initSia as initStorage,
  connect as connectStorage,
  AppKey as StorageAppKey,
  fromHex as storageFromHex,
  PinnedObject as StoragePinnedObject,
  type Sdk as StorageSdk,
  type SealedObject,
  type SlabInfo,
} from 'sia-storage';
import {
  initSia as initSiaA,
  connect as connectSiaA,
  AppKey as SiaAAppKey,
  fromHex as siaAFromHex,
} from '@siafoundation/sia';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { buildAppMeta } from './sia-app-meta.js';

interface DualSdk {
  storage: StorageSdk;        // for connect/pin/account/download/share/list
  uploadSdk: import('@siafoundation/sia').SiaClient;  // for upload only
  uploadAppKey: import('@siafoundation/sia').AppKey;
}

let sdkPromise: Promise<DualSdk> | null = null;

/**
 * Lazily initialize both SDKs (singleton).
 */
export function getClient(): Promise<DualSdk> {
  if (!sdkPromise) {
    sdkPromise = (async () => {
      await Promise.all([initStorage(), initSiaA()]);

      const appMeta = buildAppMeta(env.SIA_APP_ID);
      const storageKey = new StorageAppKey(storageFromHex(env.SIA_APP_KEY));

      logger.info(
        { indexerUrl: env.SIA_INDEXER_URL, publicKey: storageKey.publicKey() },
        'Connecting to Sia indexer',
      );
      const storage = await connectStorage(env.SIA_INDEXER_URL, appMeta, storageKey);
      if (!storage) {
        throw new Error(
          `Sia indexer at ${env.SIA_INDEXER_URL} did not recognize the App Key. ` +
            `Run onboarding: npm run sia:onboard (from backend/).`,
        );
      }

      // Connect the upload SDK with the same App Key. It uses a different
      // signing format internally for pin (which we never call on it), so
      // the same key string still works for connect/upload here.
      const uploadAppKey = new SiaAAppKey(siaAFromHex(env.SIA_APP_KEY));
      const uploadSdk = await connectSiaA(env.SIA_INDEXER_URL, uploadAppKey);
      if (!uploadSdk) {
        throw new Error(
          `Upload SDK could not connect to ${env.SIA_INDEXER_URL} with App Key.`,
        );
      }

      logger.info('Sia SDKs connected (storage + upload)');
      return { storage, uploadSdk, uploadAppKey };
    })().catch((err) => {
      sdkPromise = null;
      throw err;
    });
  }
  return sdkPromise;
}

export interface UploadResult {
  objectId: string;
  size: number;
}

/**
 * Default redundancy for Zen testnet (limited host pool: 12 contracts).
 * Tunable via env vars for production deployments with bigger host pools.
 */
const DATA_SHARDS = parseInt(process.env.SIA_DATA_SHARDS ?? '3', 10);
const PARITY_SHARDS = parseInt(process.env.SIA_PARITY_SHARDS ?? '9', 10);
const MAX_INFLIGHT = parseInt(process.env.SIA_MAX_INFLIGHT ?? '12', 10);

/**
 * Convert a value (Buffer, base64 string, Uint8Array, number array) to a
 * Node Buffer. Used when re-hydrating a SealedObject from the JSON form
 * produced by the upload SDK.
 */
function toBuffer(v: unknown): Buffer {
  if (v == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(v)) return v;
  if (typeof v === 'string') return Buffer.from(v, 'base64');
  if (Array.isArray(v)) return Buffer.from(v as number[]);
  if (v instanceof Uint8Array) return Buffer.from(v);
  return Buffer.alloc(0);
}

/**
 * Upload a Uint8Array to Sia and pin the resulting object.
 *
 * Step 1: upload via @siafoundation/sia (Buffer-direct API works).
 * Step 2: seal the resulting object → JSON.
 * Step 3: open the sealed object as a sia-storage PinnedObject.
 * Step 4: pin via sia-storage (matches indexd master signing format).
 */
export async function uploadAndPin(data: Uint8Array): Promise<UploadResult> {
  const { storage, uploadSdk, uploadAppKey } = await getClient();
  logger.debug({ size: data.length }, 'Uploading object to Sia');

  // 1. Upload via @siafoundation/sia: pass Buffer directly to add().
  const packed = uploadSdk.uploadPacked({
    dataShards: DATA_SHARDS,
    parityShards: PARITY_SHARDS,
    maxInflight: MAX_INFLIGHT,
  });
  await packed.add(Buffer.from(data));
  const objects = await packed.finalize();
  const uploaded = objects[0];
  if (!uploaded) {
    throw new Error('Sia uploadPacked.finalize() returned no objects');
  }

  // 2-3. Bridge: seal → JSON → open as the storage SDK's PinnedObject.
  const sealedJson = uploaded.seal(uploadAppKey);
  const raw =
    typeof sealedJson === 'string' ? JSON.parse(sealedJson) : (sealedJson as Record<string, unknown>);

  const sealed: SealedObject = {
    id: String((raw as { id: string }).id),
    encryptedDataKey: toBuffer((raw as Record<string, unknown>).encryptedDataKey),
    encryptedMetadataKey: toBuffer((raw as Record<string, unknown>).encryptedMetadataKey),
    encryptedMetadata: toBuffer((raw as Record<string, unknown>).encryptedMetadata),
    dataSignature: toBuffer((raw as Record<string, unknown>).dataSignature),
    metadataSignature: toBuffer((raw as Record<string, unknown>).metadataSignature),
    slabs: ((raw as { slabs?: unknown[] }).slabs ?? []).map((s) => {
      const slab = s as Record<string, unknown>;
      return {
        encryptionKey: toBuffer(slab.encryptionKey),
        minShards: Number(slab.minShards),
        offset: Number(slab.offset),
        length: Number(slab.length),
        sectors: ((slab.sectors as unknown[]) ?? []).map((sec) => {
          const sector = sec as Record<string, unknown>;
          return { root: String(sector.root), hostKey: String(sector.hostKey) };
        }),
      } satisfies SlabInfo;
    }),
    createdAt: new Date(String((raw as { createdAt: string }).createdAt)),
    updatedAt: new Date(String((raw as { updatedAt: string }).updatedAt)),
  };

  // The storage SDK's AppKey instance is held inside the singleton — re-build
  // a local one for `open()` to keep the per-call surface small and explicit.
  const storageAppKey = new StorageAppKey(storageFromHex(env.SIA_APP_KEY));
  // PinnedObject.open is declared in sia-storage's `index.node.d.ts` but
  // omitted from `index.d.ts` (browser). TS resolution picks the browser
  // type definition, so we cast through the node-side shape.
  const PinnedObjectCtor = StoragePinnedObject as unknown as {
    open(appKey: StorageAppKey, sealed: SealedObject): StoragePinnedObject;
  };
  const storageObj = PinnedObjectCtor.open(storageAppKey, sealed);

  // 4. Pin via sia-storage SDK.
  await storage.pinObject(storageObj);

  const objectId = storageObj.id();
  const size = Number(storageObj.size());
  logger.info({ objectId, size }, 'Object uploaded and pinned on Sia');
  return { objectId, size };
}

/**
 * Download an object by hex ID. Optional byte-range support.
 */
export async function downloadObject(
  objectId: string,
  options?: { offset?: number; length?: number },
): Promise<Uint8Array> {
  const { storage } = await getClient();
  logger.debug({ objectId, ...options }, 'Downloading object from Sia');

  const obj = await storage.object(objectId);

  const chunks: Buffer[] = [];
  const writeFn = async (chunk: Buffer): Promise<void> => {
    chunks.push(chunk);
  };

  const downloadOpts: { maxInflight: number; offset?: bigint; length?: bigint } = {
    maxInflight: MAX_INFLIGHT,
  };
  if (options?.offset !== undefined) downloadOpts.offset = BigInt(options.offset);
  if (options?.length !== undefined) downloadOpts.length = BigInt(options.length);

  await storage.download(writeFn, obj, downloadOpts);

  const data = Buffer.concat(chunks);
  logger.debug({ objectId, size: data.length }, 'Object downloaded from Sia');
  return new Uint8Array(data);
}

/**
 * Delete an object from the indexer.
 */
export async function deleteObject(objectId: string): Promise<void> {
  const { storage } = await getClient();
  logger.debug({ objectId }, 'Deleting object on Sia');
  await storage.deleteObject(objectId);
  logger.info({ objectId }, 'Object deleted on Sia');
}

/**
 * Remove slabs no longer referenced by any pinned object.
 */
export async function pruneSlabs(): Promise<void> {
  const { storage } = await getClient();
  logger.debug('Pruning unreferenced slabs on Sia');
  await storage.pruneSlabs();
  logger.info('Slabs pruned on Sia');
}

/**
 * Create a time-limited share URL for an object.
 */
export async function shareObject(
  objectId: string,
  expiresAt: Date,
): Promise<string> {
  const { storage } = await getClient();
  const obj = await storage.object(objectId);
  const shareUrl = storage.shareObject(obj, expiresAt);
  logger.info(
    { objectId, expiresAt: expiresAt.toISOString() },
    'Object shared on Sia',
  );
  return shareUrl;
}

/**
 * Fetch a rehydrated PinnedObject handle.
 */
export async function getObject(
  objectId: string,
): Promise<StoragePinnedObject> {
  const { storage } = await getClient();
  return storage.object(objectId);
}
