import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveEnvModel, DEFAULT_MODEL } from '../env-model.js';

const ENV_KEYS = ['PI_MODEL', 'OPENAI_MODEL'] as const;

describe('resolveEnvModel', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('falls back to DEFAULT_MODEL when no env knob is set', () => {
    expect(resolveEnvModel()).toBe(DEFAULT_MODEL);
  });

  it('uses OPENAI_MODEL when set', () => {
    process.env.OPENAI_MODEL = 'kimi-k2.6';
    expect(resolveEnvModel()).toBe('kimi-k2.6');
  });

  it('prefers PI_MODEL over OPENAI_MODEL', () => {
    process.env.PI_MODEL = 'claude-opus-4-8';
    process.env.OPENAI_MODEL = 'kimi-k2.6';
    expect(resolveEnvModel()).toBe('claude-opus-4-8');
  });
});
