import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Keep jsdom's Element, window, document and EventTarget implementations intact:
// gesture ownership and compatible-click suppression depend on propagation.
if (typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => {
      const target = new EventTarget();
      return Object.assign(target, {
        matches: false,
        media: query,
        onchange: null,
        addListener(listener: (event: MediaQueryListEvent) => void) {
          target.addEventListener('change', listener as EventListener);
        },
        removeListener(listener: (event: MediaQueryListEvent) => void) {
          target.removeEventListener('change', listener as EventListener);
        },
      }) as MediaQueryList;
    },
  });
}

// jsdom has no layout engine. Tests explicitly provide the geometry needed by
// a scenario; this observer only supplies the otherwise missing constructor.
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverStub implements ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: ResizeObserverStub,
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
