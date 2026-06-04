import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { probeModel } from '../models-probe.js';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';

const baseProfile: LlmProfileConfig = {
  id: 'p', name: 'a', providerType: 'anthropic', apiKey: 'sk-x',
  createdAt: 0, updatedAt: 0,
};

describe('probeModel', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns ok=true with latency on a fast successful completion', async () => {
    // pi-ai uses fetch under the hood; intercepting fetch lets the probe
    // call resolve without hitting the real provider.
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        id: 'msg_x', type: 'message', role: 'assistant', model: 'claude-opus-4-7',
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200, headers: { 'content-type': 'application/json' } }),
    );

    const result = await probeModel(baseProfile, 'claude-opus-4-7');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns ok=false with error message on upstream error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'no such model' } }), { status: 400 }),
    );
    const result = await probeModel(baseProfile, 'nope');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeTruthy();
  });

  it('returns ok=false on network failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await probeModel(baseProfile, 'claude-opus-4-7');
    expect(result.ok).toBe(false);
    // Anthropic SDK wraps low-level fetch failures as "Connection error.";
    // the exact message string is provider-internal — assert non-empty.
    if (!result.ok) expect(result.error).toBeTruthy();
  });
});
