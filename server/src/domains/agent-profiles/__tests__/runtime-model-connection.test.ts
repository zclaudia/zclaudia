import { describe, expect, it } from 'vitest';
import {
  toAnthropicEngineBaseUrl,
  resolveRuntimeModelConnection,
} from '../runtime-model-connection.js';
import type { LlmProfileConfig } from '@zclaudia/shared/core/llm-profile';

function profile(overrides: Partial<LlmProfileConfig>): LlmProfileConfig {
  return {
    id: 'p1',
    name: 'P1',
    providerType: 'anthropic',
    apiKey: 'sk-key',
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('toAnthropicEngineBaseUrl', () => {
  it('defaults to the Anthropic root', () => {
    expect(toAnthropicEngineBaseUrl(undefined)).toBe('https://api.anthropic.com');
  });

  it('strips a terminal /v1 while keeping proxy path prefixes', () => {
    expect(toAnthropicEngineBaseUrl('https://gw.example.com/v1')).toBe('https://gw.example.com');
    expect(toAnthropicEngineBaseUrl('https://gw.example.com/anthropic/v1/')).toBe(
      'https://gw.example.com/anthropic'
    );
    expect(toAnthropicEngineBaseUrl('https://gw.example.com/anthropic')).toBe(
      'https://gw.example.com/anthropic'
    );
  });
});

describe('resolveRuntimeModelConnection (claude sdk)', () => {
  it('resolves an anthropic profile into a connection', () => {
    const resolved = resolveRuntimeModelConnection({
      runtimeType: 'claude',
      profile: profile({ baseUrl: 'https://gw.example.com/v1' }),
      model: 'claude-opus-4-8',
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.connection).toMatchObject({
      protocol: 'anthropic-messages',
      baseUrl: 'https://gw.example.com',
    });
    expect(resolved.connection.apiKey).toBe('sk-key');
  });

  it('rejects openai profiles (strict runtime whitelist)', () => {
    const resolved = resolveRuntimeModelConnection({
      runtimeType: 'claude',
      profile: profile({ providerType: 'openai' }),
      model: 'gpt-5',
    });
    expect(resolved).toMatchObject({ ok: false, code: 'LLM_PROTOCOL_UNSUPPORTED' });
  });

  it('rejects missing keys and OAuth credentials', () => {
    expect(
      resolveRuntimeModelConnection({
        runtimeType: 'claude',
        profile: profile({ apiKey: undefined }),
        model: 'm',
      })
    ).toMatchObject({ ok: false, code: 'LLM_AUTH_UNSUPPORTED' });
    expect(
      resolveRuntimeModelConnection({
        runtimeType: 'claude',
        profile: profile({
          apiKey: undefined,
          oauthCredentials: { access: 'a', refresh: 'r', expires: 1, accountId: 'x' },
        }),
        model: 'm',
      })
    ).toMatchObject({ ok: false, code: 'LLM_AUTH_UNSUPPORTED' });
  });

  it('rejects unmappable pi-specific fields', () => {
    const resolved = resolveRuntimeModelConnection({
      runtimeType: 'claude',
      profile: profile({ compat: { cacheControlFormat: 'anthropic' } }),
      model: 'm',
    });
    expect(resolved).toMatchObject({ ok: false, code: 'LLM_PROFILE_FIELD_UNSUPPORTED' });
  });

  it('rejects reserved or control-character headers', () => {
    expect(
      resolveRuntimeModelConnection({
        runtimeType: 'claude',
        profile: profile({ requestHeaders: { Authorization: 'Bearer x' } }),
        model: 'm',
      })
    ).toMatchObject({ ok: false, code: 'LLM_OPTION_UNSUPPORTED' });
    expect(
      resolveRuntimeModelConnection({
        runtimeType: 'claude',
        profile: profile({ requestHeaders: { 'X-A': 'value\r\ninjected' } }),
        model: 'm',
      })
    ).toMatchObject({ ok: false, code: 'LLM_OPTION_UNSUPPORTED' });
  });

  it('requires an explicit model', () => {
    expect(
      resolveRuntimeModelConnection({ runtimeType: 'claude', profile: profile({}), model: ' ' })
    ).toMatchObject({ ok: false, code: 'LLM_OPTION_UNSUPPORTED' });
  });

  it('requires a profile at all', () => {
    expect(
      resolveRuntimeModelConnection({ runtimeType: 'claude', profile: null, model: 'm' })
    ).toMatchObject({ ok: false, code: 'LLM_PROFILE_REQUIRED' });
  });
});

describe('resolveRuntimeModelConnection (codex sdk)', () => {
  it('accepts an official openai endpoint without an explicit declaration', () => {
    const resolved = resolveRuntimeModelConnection({
      runtimeType: 'codex',
      profile: profile({ providerType: 'openai', apiKey: 'sk', baseUrl: undefined }),
      model: 'gpt-5-codex',
    });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      expect(resolved.connection.protocol).toBe('openai-responses');
      expect(resolved.connection.baseUrl).toBe('https://api.openai.com/v1');
    }
  });

  it('requires an explicit openai-responses declaration on custom endpoints', () => {
    const custom = { providerType: 'openai', apiKey: 'sk', baseUrl: 'https://gw.example.com/v1' };
    expect(
      resolveRuntimeModelConnection({ runtimeType: 'codex', profile: profile(custom), model: 'm' })
    ).toMatchObject({ ok: false, code: 'LLM_PROTOCOL_UNSUPPORTED' });
    expect(
      resolveRuntimeModelConnection({
        runtimeType: 'codex',
        profile: profile({ ...custom, supportedProtocols: ['openai-responses'] }),
        model: 'm',
      })
    ).toMatchObject({ ok: true });
  });

  it('treats an explicit empty declaration as no protocols', () => {
    expect(
      resolveRuntimeModelConnection({
        runtimeType: 'codex',
        profile: profile({ providerType: 'openai', supportedProtocols: [] }),
        model: 'm',
      })
    ).toMatchObject({ ok: false, code: 'LLM_PROTOCOL_UNSUPPORTED' });
  });

  it('rejects openai-codex OAuth profiles even when hand-declaring responses', () => {
    expect(
      resolveRuntimeModelConnection({
        runtimeType: 'codex',
        profile: profile({
          providerType: 'openai-codex',
          apiKey: undefined,
          oauthCredentials: { access: 'a', refresh: 'r', expires: 1, accountId: 'x' },
          supportedProtocols: ['openai-responses'],
        }),
        model: 'm',
      })
    ).toMatchObject({ ok: false, code: 'LLM_AUTH_UNSUPPORTED' });
  });

  it('rejects unknown providerType strings at runtime', () => {
    expect(
      resolveRuntimeModelConnection({
        runtimeType: 'codex',
        profile: profile({ providerType: 'OpenAI' }),
        model: 'm',
      })
    ).toMatchObject({ ok: false, code: 'LLM_PROTOCOL_UNSUPPORTED' });
    expect(
      resolveRuntimeModelConnection({
        runtimeType: 'codex',
        profile: profile({ providerType: 'deepseek' }),
        model: 'm',
      })
    ).toMatchObject({ ok: false, code: 'LLM_PROTOCOL_UNSUPPORTED' });
  });

  it('preserves proxy path prefixes without protocol rewriting', () => {
    const resolved = resolveRuntimeModelConnection({
      runtimeType: 'codex',
      profile: profile({
        providerType: 'openai',
        apiKey: 'sk',
        baseUrl: 'https://gw.example.com/openai/',
        supportedProtocols: ['openai-responses'],
      }),
      model: 'm',
    });
    if (resolved.ok) {
      expect(resolved.connection.baseUrl).toBe('https://gw.example.com/openai');
    } else {
      throw new Error('expected resolution to succeed');
    }
  });
});
