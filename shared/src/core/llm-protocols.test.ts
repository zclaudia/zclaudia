import { describe, expect, it } from 'vitest';
import {
  inferLlmWireProtocols,
  isOfficialOpenaiBaseUrl,
  resolveLlmProfileProtocols,
} from './llm-profile.js';

describe('isOfficialOpenaiBaseUrl', () => {
  it('treats empty as official', () => {
    expect(isOfficialOpenaiBaseUrl(undefined)).toBe(true);
    expect(isOfficialOpenaiBaseUrl('')).toBe(true);
    expect(isOfficialOpenaiBaseUrl('  ')).toBe(true);
  });

  it('accepts only the exact official endpoint', () => {
    expect(isOfficialOpenaiBaseUrl('https://api.openai.com/v1')).toBe(true);
    expect(isOfficialOpenaiBaseUrl('https://api.openai.com/v1/')).toBe(true);
  });

  it('rejects look-alike endpoints', () => {
    expect(isOfficialOpenaiBaseUrl('https://api.openai.com/v1/chat/completions')).toBe(false);
    expect(isOfficialOpenaiBaseUrl('https://api.openai.com.evil.io/v1')).toBe(false);
    expect(isOfficialOpenaiBaseUrl('http://api.openai.com/v1')).toBe(false);
    expect(isOfficialOpenaiBaseUrl('https://proxy.example.com/v1')).toBe(false);
    expect(isOfficialOpenaiBaseUrl('not a url')).toBe(false);
  });
});

describe('inferLlmWireProtocols', () => {
  it('anthropic maps to anthropic-messages', () => {
    expect(inferLlmWireProtocols('anthropic', undefined)).toEqual(['anthropic-messages']);
  });

  it('official openai supports completions + responses', () => {
    expect(inferLlmWireProtocols('openai', 'https://api.openai.com/v1')).toEqual([
      'openai-completions',
      'openai-responses',
    ]);
    expect(inferLlmWireProtocols('openai', undefined)).toEqual([
      'openai-completions',
      'openai-responses',
    ]);
  });

  it('custom openai baseUrl only supports completions', () => {
    expect(inferLlmWireProtocols('openai', 'https://proxy.example.com/v1')).toEqual([
      'openai-completions',
    ]);
  });

  it('unknown and oauth provider types infer nothing', () => {
    expect(inferLlmWireProtocols('openai-codex', undefined)).toEqual([]);
    expect(inferLlmWireProtocols('deepseek', undefined)).toEqual([]);
  });
});

describe('resolveLlmProfileProtocols', () => {
  it('explicit declaration is complete and deduped', () => {
    const resolved = resolveLlmProfileProtocols({
      providerType: 'openai',
      baseUrl: 'https://proxy.example.com/v1',
      supportedProtocols: ['openai-responses', 'openai-responses', 'bogus' as never],
    });
    expect(resolved).toEqual({ source: 'declared', protocols: ['openai-responses'] });
  });

  it('explicit empty array means no protocols, no inference fallback', () => {
    const resolved = resolveLlmProfileProtocols({
      providerType: 'openai',
      supportedProtocols: [],
    });
    expect(resolved).toEqual({ source: 'declared', protocols: [] });
  });

  it('falls back to inference when undeclared', () => {
    const resolved = resolveLlmProfileProtocols({ providerType: 'anthropic' });
    expect(resolved).toEqual({ source: 'inferred', protocols: ['anthropic-messages'] });
  });
});
