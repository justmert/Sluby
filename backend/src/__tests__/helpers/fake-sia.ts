/**
 * An in-memory stand-in for the sia-storage SDK at the boundary sia-client.ts
 * talks to, keeping the indexer rules the pipeline depends on:
 *
 * - each slab is pinned as soon as it is stored, the object only by
 *   pinObject (sia_storage upload.rs, sdk.rs)
 * - pruneSlabs unpins every slab no pinned object references
 *   (indexd persist/postgres/slabs.go)
 * - deleting or reading an object the indexer does not have fails with the
 *   SDK's `app error: Api(404, ...)` text
 *
 * Faults are injected per call with `fail` and `hang`. Use it with
 *   vi.mock('@siafoundation/sia-storage', () => fake.module)
 */
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

interface FakeObject {
  id: string;
  size: number;
  slabs: string[];
}

type Method = 'add' | 'finalize' | 'pinObject' | 'deleteObject' | 'pruneSlabs';

export interface FakeSia {
  /** objects pinned on the fake indexer */
  objects: Map<string, FakeObject>;
  /** slabs pinned on the fake indexer */
  slabs: Set<string>;
  /** slabs of uploads not finalized and pinned yet */
  inFlightSlabs: Set<string>;
  /** slabs a prune removed while their upload was still in flight */
  prunedInFlight: string[];
  calls: Record<Method, number>;
  /** the next calls of `method` reject with `err`, `times` times */
  fail(method: Method, err: Error, times?: number): void;
  /** the next call of `method` never settles (until the upload is cancelled) */
  hang(method: Method): void;
  /** run before every call of `method`, for interleaving tests */
  before(method: Method, fn: () => Promise<void> | void): void;
  pinnedIds(): string[];
  /** pinned slabs no pinned object references: paid for and useless until pruned */
  orphanSlabs(): string[];
  reset(): void;
  module: Record<string, unknown>;
}

export const NOT_FOUND = () => new Error('app error: Api(404, "object not found\\n")');

export function createFakeSia(): FakeSia {
  const failures = new Map<Method, Array<Error>>();
  const hangs = new Set<Method>();
  const hooks = new Map<Method, () => Promise<void> | void>();

  const fake: FakeSia = {
    objects: new Map(),
    slabs: new Set(),
    inFlightSlabs: new Set(),
    prunedInFlight: [],
    calls: { add: 0, finalize: 0, pinObject: 0, deleteObject: 0, pruneSlabs: 0 },
    fail(method, err, times = 1) {
      failures.set(method, [...(failures.get(method) ?? []), ...Array(times).fill(err)]);
    },
    hang(method) {
      hangs.add(method);
    },
    before(method, fn) {
      hooks.set(method, fn);
    },
    pinnedIds: () => [...fake.objects.keys()].sort(),
    orphanSlabs: () => {
      const used = new Set([...fake.objects.values()].flatMap((o) => o.slabs));
      return [...fake.slabs].filter((s) => !used.has(s));
    },
    reset() {
      fake.objects.clear();
      fake.slabs.clear();
      fake.inFlightSlabs.clear();
      fake.prunedInFlight = [];
      for (const k of Object.keys(fake.calls) as Method[]) fake.calls[k] = 0;
      failures.clear();
      hangs.clear();
      hooks.clear();
    },
    module: {},
  };

  /** Count the call, run its hook, then fail, hang or go on. */
  async function enter(method: Method, cancelled?: Promise<never>): Promise<void> {
    fake.calls[method]++;
    await hooks.get(method)?.();
    const queued = failures.get(method);
    if (queued?.length) throw queued.shift()!;
    if (hangs.has(method)) {
      hangs.delete(method);
      await (cancelled ?? new Promise<never>(() => {}));
    }
  }

  const handle = (o: FakeObject) => ({
    id: () => o.id,
    size: () => BigInt(o.size),
    slabs: () => o.slabs.map((s) => ({ minShards: 1, sectors: [{ root: s, hostKey: 'h' }] })),
    createdAt: () => new Date(0),
    updatedAt: () => new Date(0),
    encodedSize: () => BigInt(o.size * 3),
  });

  const sdk = {
    uploadPacked(opts?: { onShardUploaded?: () => void }) {
      const pending: FakeObject[] = [];
      let closed = false;
      let cancel: (err: Error) => void = () => {};
      const cancelled = new Promise<never>((_, reject) => {
        cancel = reject;
      });
      cancelled.catch(() => {});
      const store = async (size: number) => {
        await enter('add', cancelled);
        if (closed) throw new Error('upload closed');
        // one slab per item, pinned as soon as it is stored
        const slab = randomBytes(8).toString('hex');
        fake.slabs.add(slab);
        fake.inFlightSlabs.add(slab);
        opts?.onShardUploaded?.();
        pending.push({ id: randomBytes(32).toString('hex'), size, slabs: [slab] });
        return BigInt(size);
      };
      return {
        add: async (stream: ReadableStream<Uint8Array>) => {
          let n = 0;
          const reader = stream.getReader();
          for (let r = await reader.read(); !r.done; r = await reader.read()) n += r.value.length;
          return store(n);
        },
        addPath: async (p: string) => store((await readFile(p)).length),
        cancel: () => {
          closed = true;
          for (const o of pending) for (const sl of o.slabs) fake.inFlightSlabs.delete(sl);
          cancel(new Error('upload closed'));
        },
        finalize: async () => {
          await enter('finalize', cancelled);
          if (closed) throw new Error('upload closed');
          return pending.map(handle);
        },
      };
    },
    async pinObject(obj: ReturnType<typeof handle>) {
      await enter('pinObject');
      const slabs = obj.slabs().map((s) => s.sectors[0].root);
      // the sdk re-pins slabs a prune removed (sdk.rs pin_object)
      for (const s of slabs) fake.slabs.add(s);
      for (const s of slabs) fake.inFlightSlabs.delete(s);
      fake.objects.set(obj.id(), { id: obj.id(), size: Number(obj.size()), slabs });
    },
    async deleteObject(id: string) {
      await enter('deleteObject');
      if (!fake.objects.delete(id)) throw NOT_FOUND();
    },
    async object(id: string) {
      const o = fake.objects.get(id);
      if (!o) throw NOT_FOUND();
      return handle(o);
    },
    download(obj: ReturnType<typeof handle>) {
      const size = Number(obj.size());
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(size));
          controller.close();
        },
      });
    },
    async pruneSlabs() {
      await enter('pruneSlabs');
      const used = new Set([...fake.objects.values()].flatMap((o) => o.slabs));
      for (const s of [...fake.slabs]) {
        if (used.has(s)) continue;
        fake.slabs.delete(s);
        if (fake.inFlightSlabs.has(s)) fake.prunedInFlight.push(s);
      }
    },
    async account() {
      return { accountKey: 'fake', ready: true, remainingStorage: 0n };
    },
  };

  fake.module = {
    initSia: async () => {},
    setLogger: () => {},
    AppKey: class {},
    Builder: class {
      connected = async () => sdk;
    },
  };
  return fake;
}
