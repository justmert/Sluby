import type { UploadTabsOptions } from '@/lib/upload-tabs';

type Channel = NonNullable<UploadTabsOptions['channel']>;

/** BroadcastChannels that reach each other synchronously, as tabs of one browser would. */
export function fakeBus() {
  const members = new Set<Channel>();
  return {
    channel(): Channel {
      const ch: Channel = {
        onmessage: null,
        postMessage(data: unknown) {
          for (const other of members) {
            if (other !== ch) other.onmessage?.({ data } as MessageEvent);
          }
        },
        close() {
          members.delete(ch);
        },
      };
      members.add(ch);
      return ch;
    },
  };
}

/** The web locks api for one browser: a name is held by one callback at a time. */
export function fakeLocks() {
  const held = new Set<string>();
  return {
    held,
    request(
      name: string,
      options: { ifAvailable?: boolean },
      callback: (lock: { name: string } | null) => Promise<unknown>,
    ) {
      if (held.has(name)) {
        if (!options.ifAvailable) throw new Error('fake locks only do ifAvailable');
        return Promise.resolve(callback(null));
      }
      held.add(name);
      return Promise.resolve(callback({ name })).finally(() => held.delete(name));
    },
    query() {
      return Promise.resolve({ held: [...held].map((name) => ({ name })), pending: [] });
    },
  } as unknown as LockManager & { held: Set<string> };
}
