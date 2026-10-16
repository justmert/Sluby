import type { UserEvent } from '@testing-library/user-event';

type Real = typeof import('@testing-library/user-event').default;
type Options = NonNullable<Parameters<Real['setup']>[0]>;

/** What a user-event call or a findBy left running past its test rejects with. */
export class OutlivedTest extends Error {
  constructor() {
    super('a user-event call or a testing-library wait outlived its test and was stopped');
  }
}

// each test is a generation; a call belongs to the one it started in. a test
// that times out leaves its typing running, and without this the keys went
// to whatever the next test had focused
let generation = 0;
const pending = new Set<Promise<unknown>>();
const waiting = new Set<(err: Error) => void>();
// taken before any test can swap in fake timers
const realSetTimeout = globalThis.setTimeout;

// user-event waits on both its own timer and config.advanceTimers between
// every key and action. the guard holds its half of that wait open for the
// same delay on a real timer, so ending the test can fail the wait at once,
// even one whose own timer is fake and will never fire
function guarded(advance: Options['advanceTimers']): Options['advanceTimers'] {
  const owner = generation;
  return (ms) =>
    new Promise<void>((resolve, reject) => {
      if (owner !== generation) {
        reject(new OutlivedTest());
        return;
      }
      waiting.add(reject);
      const done = () => waiting.delete(reject);
      Promise.resolve(advance?.(ms)).then(
        () =>
          realSetTimeout(() => {
            done();
            resolve();
          }, ms),
        (err: unknown) => {
          done();
          reject(err);
        },
      );
    });
}

// no handler is attached here, so a call that fails and is not awaited still
// shows up as an unhandled rejection; endUserEvents waits on them all
function track<T>(call: () => Promise<T>): Promise<T> {
  const p = call();
  pending.add(p);
  return p;
}

function guardInstance(api: UserEvent): UserEvent {
  const out = { ...api } as Record<string, unknown>;
  for (const [name, fn] of Object.entries(api)) {
    if (name === 'setup') continue;
    out[name] = (...args: unknown[]) =>
      track(() => (fn as (...a: unknown[]) => Promise<unknown>)(...args));
  }
  // a sub instance keeps its parent's guard unless it brings its own timers
  out.setup = (options: Options = {}) =>
    guardInstance(
      api.setup(
        options.advanceTimers
          ? { ...options, advanceTimers: guarded(options.advanceTimers) }
          : options,
      ),
    );
  return out as unknown as UserEvent;
}

// where each direct call takes its options; tab and clear read none, and
// they dispatch everything before their one closing wait
const OPTIONS_AT: Record<string, number> = {
  click: 1,
  dblClick: 1,
  tripleClick: 1,
  hover: 1,
  unhover: 1,
  copy: 0,
  cut: 0,
  paste: 1,
  keyboard: 1,
  pointer: 1,
  type: 2,
  upload: 2,
  selectOptions: 2,
  deselectOptions: 2,
};

/** user-event with every call stopped once the test that made it is over. */
export function guardUserEvent(real: Real): Real {
  const out = { ...real } as Record<string, unknown>;
  for (const [name, fn] of Object.entries(real)) {
    if (name === 'setup') continue;
    const at = OPTIONS_AT[name];
    out[name] = (...args: unknown[]) => {
      if (at !== undefined) {
        const options = (args[at] ?? {}) as Options;
        args[at] = { ...options, advanceTimers: guarded(options.advanceTimers) };
      }
      return track(() => (fn as (...a: unknown[]) => Promise<unknown>)(...args));
    };
  }
  out.setup = (options: Options = {}) =>
    guardInstance(real.setup({ ...options, advanceTimers: guarded(options.advanceTimers) }));
  return out as unknown as Real;
}

/**
 * Ends the current test's user-event calls: each one fails its current wait
 * with OutlivedTest, so it dispatches nothing more. Resolves once
 * they have all stopped.
 */
export async function endUserEvents(): Promise<void> {
  generation += 1;
  for (const reject of waiting) reject(new OutlivedTest());
  waiting.clear();
  const left = [...pending];
  pending.clear();
  await Promise.allSettled(left);
}

type Library = typeof import('@testing-library/react');

/**
 * A findBy or waitFor still pending when its test timed out keeps polling
 * the page, which is the next test's by then; once it matches there, the
 * dead test carried on and clicked in the new page. Each one now belongs to
 * the test it started in, and one that settles after that test rejects with
 * OutlivedTest instead, so the dead test stops there.
 */
export function guardAsyncUtils({
  getConfig,
  configure,
}: Pick<Library, 'getConfig' | 'configure'>) {
  const previous = getConfig().asyncWrapper;
  configure({
    asyncWrapper: async (cb) => {
      const owner = generation;
      const result: unknown = await previous(cb);
      if (owner !== generation) throw new OutlivedTest();
      return result;
    },
  });
}
