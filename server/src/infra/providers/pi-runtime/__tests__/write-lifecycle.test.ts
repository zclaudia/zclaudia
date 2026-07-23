import { describe, expect, it, vi } from 'vitest';

import {
  getDeferredDiagnosticsResult,
  scheduleDeferredDiagnostics,
  type WriteLifecycleInput,
} from '../write-lifecycle.js';

const input: WriteLifecycleInput = {
  operation: 'write',
  type: 'create',
  path: 'f.ts',
  absolutePath: '/tmp/f.ts',
  originalContent: null,
  updatedContent: 'const a = 1;\n',
  diff: '',
};

describe('deferred diagnostics lifecycle', () => {
  it('deletes a completed result on retrieval', async () => {
    const scheduled = scheduleDeferredDiagnostics(
      async () => [{ path: 'f.ts', severity: 'warning', message: 'late warning' }],
      input
    );
    const id = scheduled?.deferredDiagnostics?.id;
    expect(id).toBeTruthy();

    await vi.waitFor(() => {
      expect(getDeferredDiagnosticsResult(String(id))?.status).toBe('completed');
    });

    // The terminal result was consumed by the read above: a second read (and
    // therefore the map) no longer holds it.
    expect(getDeferredDiagnosticsResult(String(id))).toBeUndefined();
  });

  it('deletes a failed result on retrieval', async () => {
    const scheduled = scheduleDeferredDiagnostics(async () => {
      throw new Error('provider exploded');
    }, input);
    const id = String(scheduled?.deferredDiagnostics?.id);

    await vi.waitFor(() => {
      expect(getDeferredDiagnosticsResult(id)?.status).toBe('failed');
    });
    expect(getDeferredDiagnosticsResult(id)).toBeUndefined();
  });

  it('keeps pending results readable until they settle', async () => {
    let resolveProvider!: (diagnostics: never[]) => void;
    const scheduled = scheduleDeferredDiagnostics(
      () => new Promise<never[]>(resolve => (resolveProvider = resolve)),
      input
    );
    const id = String(scheduled?.deferredDiagnostics?.id);

    // Repeated polls while pending must not consume the entry.
    expect(getDeferredDiagnosticsResult(id)).toEqual({ status: 'pending' });
    expect(getDeferredDiagnosticsResult(id)).toEqual({ status: 'pending' });

    // The provider is invoked on a microtask — let it start before resolving.
    await new Promise(resolve => setTimeout(resolve, 0));
    resolveProvider([]);
    await vi.waitFor(() => {
      expect(getDeferredDiagnosticsResult(id)?.status).toBe('completed');
    });
  });

  it('evicts entries older than the TTL via lazy sweep', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const scheduled = scheduleDeferredDiagnostics(async () => [], input);
      const id = String(scheduled?.deferredDiagnostics?.id);
      expect(getDeferredDiagnosticsResult(id)).toEqual({ status: 'pending' });

      // Just past the 10-minute TTL.
      vi.setSystemTime(Date.now() + 11 * 60 * 1000);

      expect(getDeferredDiagnosticsResult(id)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not evict entries within the TTL', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const scheduled = scheduleDeferredDiagnostics(async () => [], input);
      const id = String(scheduled?.deferredDiagnostics?.id);

      vi.setSystemTime(Date.now() + 9 * 60 * 1000);

      expect(getDeferredDiagnosticsResult(id)).toEqual({ status: 'pending' });
    } finally {
      vi.useRealTimers();
    }
  });
});
