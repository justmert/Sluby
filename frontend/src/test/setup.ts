import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, vi } from 'vitest';
import { unmockedRequests } from './unmocked';

// ci runners and loaded dev machines are slow; the defaults (5 s per test,
// 1 s for findBy and waitFor) turn that into failures that are not bugs
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });
configure({ asyncUtilTimeout: 10_000 });

afterEach(() => {
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
