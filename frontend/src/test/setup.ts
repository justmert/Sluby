import '@testing-library/jest-dom/vitest';
import { cleanup, configure, getConfig } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { toast } from 'sonner';
import { afterEach, vi } from 'vitest';
import { unmockedRequests } from './unmocked';
import { endUserEvents, guardAsyncUtils, guardUserEvent } from './user-event-guard';

// the one switch for motion in tests: every motion animation jumps straight
// to its end state (enter, exit, layout, NumberTicker counts), so assertions
// see final values and leaving elements unmount without waiting on frames.
// components under test still need motion features, which renderPage and
// renderWithMotion supply synchronously through MotionProvider.
MotionGlobalConfig.skipAnimations = true;

// every test file gets user-event through the guard, so a call cannot keep
// typing into the next test after its own timed out
vi.mock('@testing-library/user-event', async (importOriginal) => {
  const real = await importOriginal<typeof import('@testing-library/user-event')>();
  const userEvent = guardUserEvent(real.default);
  return { ...real, default: userEvent, userEvent };
});

// after react testing library set its own wrapper, which this one calls
guardAsyncUtils({ getConfig, configure });

afterEach(async () => {
  // stop what the test left running before its page goes: user-event calls
  // first, then fake timers, which would otherwise carry into the next test
  await endUserEvents();
  if (vi.isFakeTimers()) {
    vi.clearAllTimers();
    vi.useRealTimers();
  }
  cleanup();
  // sonner keeps toasts in module state and replays live ones to the next
  // Toaster, so one test's toasts would show up in the next
  toast.dismiss();
  localStorage.clear();
  document.documentElement.className = '';
  if (unmockedRequests.length > 0) {
    const seen = unmockedRequests.splice(0);
    throw new Error(`Requests no jsonFetch route answered:\n${seen.join('\n')}`);
  }
});

// jsdom has no matchMedia; tests drive it through this stub
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// radix measures and captures pointers; jsdom implements neither
if (!('ResizeObserver' in window)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(window, 'ResizeObserver', { writable: true, value: ResizeObserverStub });
}
for (const name of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
  if (!(name in Element.prototype)) {
    Object.defineProperty(Element.prototype, name, {
      writable: true,
      value: name === 'hasPointerCapture' ? () => false : () => {},
    });
  }
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
