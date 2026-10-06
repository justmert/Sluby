// Stands in for @siafoundation/sia-storage in the browser tests (aliased in
// vitest.browser.config.ts), so the real @sluby/sdk SiaSession runs against
// a fake Sia network: a share url resolves to the fixture object it names, and
// a download streams that object's bytes the way the WASM SDK does. Bytes come
// from the fixture's /__fixture/sia/ endpoint, which is not the gateway.

export interface FakeSiaLog {
  connects: number;
  resolved: string[];
  downloads: Array<{ objectId: string; offset?: number; length?: number }>;
}

export const fakeSiaLog: FakeSiaLog = { connects: 0, resolved: [], downloads: [] };

export function resetFakeSia(): void {
  fakeSiaLog.connects = 0;
  fakeSiaLog.resolved = [];
  fakeSiaLog.downloads = [];
}

const SHARE_URL_RE = /^sia:\/\/[^/]+\/objects\/([0-9a-f]+)\/shared/;
// small reads, so the loader stitches each response from several chunks
const CHUNK = 4096;

class FakePinnedObject {
  constructor(readonly objectId: string) {}
}

class FakeSdk {
  async objectFromShareUrl(url: string): Promise<FakePinnedObject> {
    const m = SHARE_URL_RE.exec(url);
    if (!m) throw new Error(`not a share url: ${url}`);
    fakeSiaLog.resolved.push(url);
    return new FakePinnedObject(m[1]);
  }

  download(
    object: FakePinnedObject,
    options?: { offset?: number; length?: number },
  ): ReadableStream {
    fakeSiaLog.downloads.push({
      objectId: object.objectId,
      offset: options?.offset,
      length: options?.length,
    });
    let bytes: Uint8Array | null = null;
    let pos = options?.offset ?? 0;
    let end = 0;
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (!bytes) {
          const res = await fetch(`/__fixture/sia/${object.objectId}`);
          if (!res.ok) {
            controller.error(new Error(`no object ${object.objectId} on the fake network`));
            return;
          }
          bytes = new Uint8Array(await res.arrayBuffer());
          end = options?.length === undefined ? bytes.length : pos + options.length;
          if (end > bytes.length) {
            controller.error(new Error(`range ${pos}-${end} past object end ${bytes.length}`));
            return;
          }
        }
        if (pos >= end) {
          controller.close();
          return;
        }
        const next = Math.min(pos + CHUNK, end);
        controller.enqueue(bytes.slice(pos, next));
        pos = next;
      },
    });
  }
}

export async function initSia(): Promise<void> {}

export class AppKey {
  constructor(readonly seed: Uint8Array) {}
}

export class Builder {
  constructor(
    readonly indexerUrl: string,
    readonly meta: unknown,
  ) {}

  async connected(_key: AppKey): Promise<FakeSdk> {
    fakeSiaLog.connects += 1;
    return new FakeSdk();
  }
}
