import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchCodexModels, _resetCodexModelsCacheForTest } from '../codex-models.js';

const ORIG_FETCH = globalThis.fetch;

describe('codex-models', () => {
  beforeEach(() => {
    _resetCodexModelsCacheForTest();
  });
  afterEach(() => {
    globalThis.fetch = ORIG_FETCH;
    vi.restoreAllMocks();
  });

  it('fetches live models from /codex/models and clamps contextWindow to 272_000', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({
        models: [
          { slug: 'gpt-5-codex', display_name: 'GPT-5 Codex', context_window: 1_000_000 },
          { slug: 'gpt-5-codex-mini', display_name: 'GPT-5 Codex Mini', context_window: 400_000 },
        ],
      }), { status: 200 }),
    ) as any;

    const result = await fetchCodexModels('p1', 'tok-abc', 'acct_xyz');
    expect(result.source).toBe('live');
    expect(result.models).toHaveLength(2);
    for (const m of result.models) {
      expect(m.contextWindow).toBe(272_000);
    }
  });

  it('returns cached result on second call within TTL', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ models: [{ slug: 'gpt-5-codex' }] }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as any;

    const first = await fetchCodexModels('p1', 'tok-abc', 'acct_xyz');
    const second = await fetchCodexModels('p1', 'tok-abc', 'acct_xyz');
    expect(first.source).toBe('live');
    expect(second.source).toBe('cache');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to pi-ai bundled list on fetch failure', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('boom', { status: 500 }),
    ) as any;

    const result = await fetchCodexModels('p1', 'tok-abc', 'acct_xyz');
    expect(result.source).toBe('fallback');
    expect(result.models.length).toBeGreaterThan(0);
    for (const m of result.models) {
      expect(m.contextWindow).toBe(272_000);
    }
  });

  it('refresh=true bypasses cache', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ models: [{ slug: 'gpt-5-codex' }] }), { status: 200 }),
    );
    globalThis.fetch = fetchMock as any;

    await fetchCodexModels('p1', 'tok-abc', 'acct_xyz');
    await fetchCodexModels('p1', 'tok-abc', 'acct_xyz', { refresh: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
