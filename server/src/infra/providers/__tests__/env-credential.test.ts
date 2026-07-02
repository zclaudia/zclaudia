import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveEnvCredential } from '../env-credential.js';

const ENV = ['OPENAI_BASE_URL', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'];
const SAVED: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of ENV) {
    SAVED[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of ENV) {
    if (SAVED[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED[k];
  }
});

describe('resolveEnvCredential', () => {
  it('returns null when no credential env is set', () => {
    expect(resolveEnvCredential()).toBeNull();
  });
  it('OPENAI_BASE_URL + OPENAI_API_KEY → openai profile with baseUrl+apiKey', () => {
    process.env.OPENAI_BASE_URL = 'http://127.0.0.1:3000/v1';
    process.env.OPENAI_API_KEY = 'sk-oai';
    expect(resolveEnvCredential()).toEqual({
      providerType: 'openai',
      baseUrl: 'http://127.0.0.1:3000/v1',
      apiKey: 'sk-oai',
    });
  });
  it('OPENAI_BASE_URL set but OPENAI_API_KEY empty → null (no usable key)', () => {
    process.env.OPENAI_BASE_URL = 'http://127.0.0.1:3000/v1';
    process.env.OPENAI_API_KEY = '   ';
    expect(resolveEnvCredential()).toBeNull();
  });
  it('ANTHROPIC_API_KEY (no openai base url) → anthropic profile with apiKey', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    expect(resolveEnvCredential()).toEqual({ providerType: 'anthropic', apiKey: 'sk-ant' });
  });
  it('OPENAI_BASE_URL wins over ANTHROPIC_API_KEY (proxy is the global route)', () => {
    process.env.OPENAI_BASE_URL = 'http://127.0.0.1:3000/v1';
    process.env.OPENAI_API_KEY = 'sk-oai';
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    expect(resolveEnvCredential()).toEqual({
      providerType: 'openai',
      baseUrl: 'http://127.0.0.1:3000/v1',
      apiKey: 'sk-oai',
    });
  });
});
