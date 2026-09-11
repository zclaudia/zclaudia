import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithRuntimeInitializationRetry } from '../runtime-initialization-retry';

const pending = () =>
  new Response(JSON.stringify({ success: false, error: { code: 'RUNTIMES_INITIALIZING' } }), {
    status: 503,
  });

describe('runtime initialization retries', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('retries reads on the same backend and returns the ready response', async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(pending())
      .mockResolvedValue(new Response('{"success":true}'));
    vi.stubGlobal('fetch', fetch);
    const result = fetchWithRuntimeInitializationRetry('http://backend/api/agent-profiles');
    await vi.advanceTimersByTimeAsync(1000);
    expect((await result).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.every(call => call[0] === 'http://backend/api/agent-profiles')).toBe(
      true
    );
  });

  it('does not replay mutations or unrelated failures', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(pending())
      .mockResolvedValue(new Response('{"error":{"code":"OTHER"}}', { status: 503 }));
    vi.stubGlobal('fetch', fetch);
    expect(
      (await fetchWithRuntimeInitializationRetry('/api/projects', { method: 'POST', body: '{}' }))
        .status
    ).toBe(503);
    expect((await fetchWithRuntimeInitializationRetry('/api/agent-profiles')).status).toBe(503);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('cancels an initialization wait without issuing another request', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(async () => pending());
    vi.stubGlobal('fetch', fetch);
    const abort = new AbortController();
    const result = fetchWithRuntimeInitializationRetry('/api/agent-profiles', {
      signal: abort.signal,
    });
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(50);
    abort.abort();
    await rejected;
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('returns the initialization error after a bounded wait', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(async () => pending());
    vi.stubGlobal('fetch', fetch);
    const result = fetchWithRuntimeInitializationRetry('/api/agent-profiles');
    await vi.advanceTimersByTimeAsync(10000);
    expect((await result).status).toBe(503);
    expect(fetch).toHaveBeenCalledTimes(11);
  });
});
