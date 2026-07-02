import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { streamSimple } from '@earendil-works/pi-ai';
import { buildModel } from '../build-model.js';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';

/**
 * Capture the provider payload via onPayload, then throw a sentinel to stop
 * the request BEFORE any network I/O (pi-ai awaits onPayload pre-send in both
 * the anthropic and openai-completions providers).
 */
const SENTINEL = new Error('payload captured — abort before network');

async function capturePayload(
  model: any,
  streamOpts: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  let captured: Record<string, unknown> | undefined;
  const context = {
    systemPrompt: 'You are a payload test.',
    messages: [{ role: 'user' as const, content: 'hi', timestamp: 0 }],
  };
  try {
    const stream = streamSimple(model, context, {
      apiKey: 'test-key',
      ...streamOpts,
      onPayload: (payload: unknown) => {
        captured = payload as Record<string, unknown>;
        throw SENTINEL;
      },
    });

    for await (const _event of stream) {
      /* drain until error */
    }
  } catch {
    /* sentinel (possibly provider-wrapped) expected */
  }
  if (!captured) throw new Error('onPayload was never invoked');
  return captured;
}

function profile(extra: Partial<LlmProfileConfig>): LlmProfileConfig {
  return {
    id: 'p',
    name: 'p',
    isDefault: false,
    createdAt: 0,
    updatedAt: 0,
    providerType: 'anthropic',
    ...extra,
  } as LlmProfileConfig;
}

// Save and restore PI_CACHE_RETENTION env so a developer's env can't flip outcomes.
let savedPiCacheRetention: string | undefined;

beforeEach(() => {
  savedPiCacheRetention = process.env.PI_CACHE_RETENTION;
  delete process.env.PI_CACHE_RETENTION;
});

afterEach(() => {
  if (savedPiCacheRetention !== undefined) {
    process.env.PI_CACHE_RETENTION = savedPiCacheRetention;
  } else {
    delete process.env.PI_CACHE_RETENTION;
  }
});

describe('cache_control payload serialization (real pi-ai)', () => {
  it('anthropic path applies ephemeral cache_control by default', async () => {
    const { model } = buildModel(
      profile({ providerType: 'anthropic', apiKey: 'k' }),
      'claude-sonnet-4-6'
    );
    const payload = await capturePayload(model);
    expect(JSON.stringify(payload)).toContain('"cache_control"');
    expect(JSON.stringify(payload)).toContain('"ephemeral"');
    expect(JSON.stringify(payload)).not.toContain('"ttl"');
  });

  it('cacheRetention long adds ttl 1h', async () => {
    const { model } = buildModel(
      profile({ providerType: 'anthropic', apiKey: 'k' }),
      'claude-sonnet-4-6'
    );
    const payload = await capturePayload(model, { cacheRetention: 'long' });
    expect(JSON.stringify(payload)).toContain('"ttl":"1h"');
  });

  it('cacheRetention none omits all cache_control markers', async () => {
    const { model } = buildModel(
      profile({ providerType: 'anthropic', apiKey: 'k' }),
      'claude-sonnet-4-6'
    );
    const payload = await capturePayload(model, { cacheRetention: 'none' });
    expect(JSON.stringify(payload)).not.toContain('cache_control');
  });

  it('openai-compat path adds markers only with compat.cacheControlFormat anthropic', async () => {
    const base = { providerType: 'openai', baseUrl: 'http://127.0.0.1:9/v1', apiKey: 'k' };
    const without = buildModel(profile(base), 'unregistered-claude-proxy');
    const withCompat = buildModel(
      profile({ ...base, compat: { cacheControlFormat: 'anthropic' } }),
      'unregistered-claude-proxy'
    );
    const p1 = await capturePayload(without.model);
    const p2 = await capturePayload(withCompat.model);
    expect(JSON.stringify(p1)).not.toContain('cache_control');
    expect(JSON.stringify(p2)).toContain('"cache_control"');
  });
});
